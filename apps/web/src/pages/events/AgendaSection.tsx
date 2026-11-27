import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type EventDetail, type Person, type Task } from "../../api";
import { Alert } from "../../components/Form";
import { formatDuration, formatShortClock, formatTime } from "../../time";
import { AgendaItemEditor, type AgendaItemValues } from "./agenda/AgendaItemEditor";
import { TemplatePicker } from "./agenda/TemplatePicker";
import type { PickerPerson } from "./agenda/WhoPicker";
import type { Mutate } from "./EventEditor";
import { AvatarStack } from "../../components/Avatar";
import { Icon } from "../../components/Icon";

/** Everyone "Who" can offer: the team's people list, plus anyone already on this event who isn't on it. */
export function pickerPeople(detail: EventDetail, people: Person[]): PickerPerson[] {
  const list: PickerPerson[] = people.map((p) =>
    p.kind === "member"
      ? {
          key: `u:${p.userId}`,
          name: p.name,
          email: p.email,
          ref: { userId: p.userId },
          status: p.status,
        }
      : {
          key: `c:${p.contactId}`,
          name: p.name,
          email: p.email,
          ref: { contactId: p.contactId },
          status: p.status,
        },
  );
  const known = new Set(list.map((p) => p.key));
  for (const part of detail.participants) {
    const key = part.userId ? `u:${part.userId}` : part.contactId ? `c:${part.contactId}` : `p:${part.id}`;
    if (!known.has(key))
      list.push({
        key,
        name: part.name,
        email: part.email,
        ref: { participantId: part.id },
        status: "guest",
      });
  }
  return list;
}

/** The program: What, Duration and Who for each item, in order, with start times worked out. */
function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      {[7, 12, 17].flatMap((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />))}
    </svg>
  );
}

/** One agenda row that can be dragged by its grip. Rows that can't move render a spacer instead. */
function SortableRow({
  id,
  label,
  movable,
  className,
  children,
}: {
  id: string;
  label: string;
  movable: boolean;
  className?: string;
  children: (grip: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !movable });
  const grip = movable ? (
    <button type="button" ref={setActivatorNodeRef} className="agenda-grip" aria-label={`Drag to reorder ${label}`} {...attributes} {...listeners}>
      <GripIcon />
    </button>
  ) : (
    <span className="agenda-grip agenda-grip-off" aria-hidden="true" />
  );
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={clsx(className, isDragging && "is-dragging")}>
      {children(grip)}
    </li>
  );
}

export function AgendaSection({
  detail,
  mutate,
  people,
  reloadPeople,
  others = [],
  onEditing,
}: {
  detail: EventDetail;
  mutate: Mutate;
  people: Person[];
  reloadPeople: () => void;
  /** Drafts: the other Admins and Planners with it open, and the item each has open. */
  others?: { userId: string; name: string; taskId: string | null }[];
  /** Tells the others which item you have open. */
  onEditing?: (taskId: string | null) => void;
}) {
  const { participants, permissions, event, schedule } = detail;
  // While a drag is being saved, show the new order straight away.
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const tasks = useMemo(
    () => (pendingOrder ? pendingOrder.map((id) => detail.tasks.find((t) => t.id === id)).filter((t): t is Task => !!t) : detail.tasks),
    [pendingOrder, detail.tasks],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => onEditing?.(editingId), [editingId, onEditing]);
  const editorOf = (taskId: string) => others.find((o) => o.taskId === taskId)?.name.split(" ")[0] ?? null;
  const [adding, setAdding] = useState(false);
  const [choosingTemplate, setChoosingTemplate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickable = useMemo(() => pickerPeople(detail, people), [detail, people]);
  // Who on an existing item, as picker entries.
  const whoFor = (task: Task): PickerPerson[] =>
    task.assigneeIds.flatMap((pid) => {
      const part = participants.find((p) => p.id === pid);
      if (!part) return [];
      const key = part.userId ? `u:${part.userId}` : part.contactId ? `c:${part.contactId}` : `p:${part.id}`;
      return [
        pickable.find((p) => p.key === key) ?? {
          key,
          name: part.name,
          email: part.email,
          ref: { participantId: part.id },
          status: "guest" as const,
        },
      ];
    });
  const nameOf = (pid: string) => participants.find((p) => p.id === pid)?.name ?? "Removed";

  const published = event.status === "approved" || event.status === "live";
  const createPerson = async (name: string, email: string | null): Promise<PickerPerson> => {
    const { person } = await api<{ person: Person }>(`/teams/${event.teamId}/people`, { method: "POST", body: email ? { name, email } : { name } });
    reloadPeople();
    return person.kind === "member"
      ? {
          key: `u:${person.userId}`,
          name: person.name,
          email: person.email,
          ref: { userId: person.userId },
          status: "member",
        }
      : {
          key: `c:${person.contactId}`,
          name: person.name,
          email: person.email,
          ref: { contactId: person.contactId },
          status: person.status,
        };
  };

  // In a draft, length and who can be left for later (null and none).
  const toBody = (v: AgendaItemValues) => ({
    title: v.title,
    durationMinutes: v.durationMinutes,
    ...(v.who.length ? { who: v.who } : { assigneeIds: [] }),
  });

  // Once live, items that have started stay where they are (the API enforces this too).
  const firstMovable = tasks.findIndex((t) => t.status === "upcoming");
  const editable = (t: Task) => permissions.canEdit && t.status !== "done" && t.status !== "skipped";
  const STATUS_TAG: Record<string, string> = {
    done: "Done",
    in_progress: "Now",
    skipped: "Skipped",
  };

  const movable = (t: Task, index: number) => editable(t) && t.status === "upcoming" && editingId === null && (firstMovable < 0 || index >= firstMovable);

  async function saveOrder(ids: string[]) {
    setError(null);
    setPendingOrder(ids);
    try {
      await mutate("/tasks/order", "PUT", { taskIds: ids });
    } catch {
      setError("Couldn't move that item. Reload the page and try again.");
    } finally {
      setPendingOrder(null);
    }
  }

  function move(task: Task, delta: -1 | 1) {
    const ids = tasks.map((t) => t.id);
    const i = ids.indexOf(task.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    void saveOrder(arrayMove(ids, i, j));
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const ids = tasks.map((t) => t.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    // Items that have already started or finished stay put.
    if (firstMovable >= 0 && to < firstMovable) return;
    void saveOrder(arrayMove(ids, from, to));
  }

  const editorProps = {
    teamId: event.teamId,
    people: pickable,
    needEmailForNew: published,
    onCreatePerson: createPerson,
    draft: event.status === "draft",
  };

  return (
    <section className="section agenda-section" aria-labelledby="agenda-heading">
      <h2 id="agenda-heading" className="visually-hidden">
        Agenda
      </h2>
      <Alert>{error}</Alert>

      {tasks.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            <ol className="agenda-list">
              {tasks.map((task, index) =>
                editingId === task.id ? (
                  <SortableRow key={task.id} id={task.id} label={task.title} movable={false}>
                    {() => (
                      <>
                        <AgendaItemEditor
                          {...editorProps}
                          initial={task}
                          initialWho={whoFor(task)}
                          onCancel={() => setEditingId(null)}
                          onSave={async (v) => {
                            await mutate(`/tasks/${task.id}`, "PATCH", toBody(v));
                            setEditingId(null);
                            reloadPeople();
                          }}
                          onDelete={
                            task.status === "upcoming"
                              ? async () => {
                                  await mutate(`/tasks/${task.id}`, "DELETE");
                                  setEditingId(null);
                                }
                              : undefined
                          }
                        />
                      </>
                    )}
                  </SortableRow>
                ) : (
                  <SortableRow
                    key={task.id}
                    id={task.id}
                    label={task.title}
                    movable={movable(task, index)}
                    className={clsx("agenda-card", `task-${task.status}`)}
                  >
                    {(grip) => (
                      <>
                        <div className="agenda-card-row">
                          {permissions.canEdit && grip}
                          <span className="agenda-time" title={`${formatTime(task.startAt, event.timezone)} – ${formatTime(task.endAt, event.timezone)}`}>
                            {formatShortClock(task.startAt, event.timezone)}
                          </span>
                          {editable(task) ? (
                            <button
                              type="button"
                              className="agenda-card-main"
                              onClick={() => {
                                setAdding(false);
                                setEditingId(task.id);
                              }}
                              aria-label={`Edit ${task.title}`}
                            >
                              <CardCells task={task} who={task.assigneeIds.map(nameOf)} tag={STATUS_TAG[task.status]} editor={editorOf(task.id)} />
                            </button>
                          ) : (
                            <div className="agenda-card-main">
                              <CardCells task={task} who={task.assigneeIds.map(nameOf)} tag={STATUS_TAG[task.status]} editor={editorOf(task.id)} />
                            </div>
                          )}
                          <div className="agenda-card-actions">
                            {editable(task) && (
                              <>
                                <button
                                  type="button"
                                  className="agenda-icon"
                                  aria-label={`Move ${task.title} up`}
                                  disabled={task.status !== "upcoming" || index === 0 || index <= firstMovable}
                                  onClick={() => move(task, -1)}
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  className="agenda-icon"
                                  aria-label={`Move ${task.title} down`}
                                  disabled={task.status !== "upcoming" || index === tasks.length - 1}
                                  onClick={() => move(task, 1)}
                                >
                                  ↓
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </SortableRow>
                ),
              )}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      {tasks.length === 0 && !permissions.canEdit && <p className="muted">Nothing on the agenda yet.</p>}

      {permissions.canEdit &&
        (adding ? (
          <AgendaItemEditor
            // A fresh form after each save, for quick entry.
            key={tasks.length}
            {...editorProps}
            onCancel={() => setAdding(false)}
            onSave={async (v) => {
              await mutate("/tasks", "POST", toBody(v));
              reloadPeople();
            }}
          />
        ) : choosingTemplate ? (
          <TemplatePicker
            teamId={event.teamId}
            eventId={event.id}
            onClose={() => setChoosingTemplate(false)}
            onUse={async (sourceEventId) => {
              await mutate("/copy-from", "POST", { sourceEventId });
              setChoosingTemplate(false);
            }}
          />
        ) : (
          <div className="agenda-add-row">
            <button
              type="button"
              className="agenda-add"
              onClick={() => {
                setEditingId(null);
                setAdding(true);
              }}
            >
              <Icon name="plus" /> Add an item
            </button>
            {tasks.length === 0 && (
              <>
                <span className="muted">or</span>
                <button type="button" className="text-link" onClick={() => setChoosingTemplate(true)}>
                  start from a template
                </button>
              </>
            )}
          </div>
        ))}
      {tasks.length > 0 && (
        <p className="agenda-foot">
          <span>{permissions.canEdit ? "Drag the dots to reorder" : ""}</span>
          <span>Ends {formatTime(schedule.endsAt, event.timezone)}</span>
        </p>
      )}
    </section>
  );
}

function CardCells({ task, who, tag, editor }: { task: Task; who: string[]; tag?: string; editor?: string | null }) {
  return (
    <>
      <span className="agenda-cell-what">
        {task.title}
        {tag && <span className={`task-tag task-${task.status}`}>{tag}</span>}
        {editor && <span className="task-editing">{editor} is editing</span>}
      </span>
      <span className={clsx("agenda-cell-duration", task.durationMinutes === null && "is-missing")}>
        {task.durationMinutes === null ? "Add length" : formatDuration(task.durationMinutes)}
      </span>
      <span className="agenda-cell-who">
        {who.length ? (
          <>
            <AvatarStack names={who} />
            <span className="agenda-who-names">{who.join(", ")}</span>
          </>
        ) : (
          <span className="muted">Nobody yet</span>
        )}
      </span>
    </>
  );
}

import { useState } from "react";
import type { EventDetail, Task } from "../../api";
import { Alert } from "../../components/Form";
import { formatDuration, formatTime } from "../../time";
import type { Mutate } from "./EventEditor";
import { TaskComments } from "./TaskComments";
import { TaskForm, type TaskValues } from "./TaskForm";

/** The timed agenda: tasks in order (single stage), with computed times and assignees. */
export function AgendaSection({ detail, mutate }: { detail: EventDetail; mutate: Mutate }) {
  const { tasks, participants, permissions, event } = detail;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(tasks.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [openComments, setOpenComments] = useState<string | null>(null);
  const commentCount = (taskId: string) => detail.comments.filter((c) => c.taskId === taskId).length;

  const nameOf = (pid: string) => participants.find((p) => p.id === pid)?.name ?? "Removed";

  // Once live, tasks that have started stay where they are (the API enforces this too).
  const firstMovable = tasks.findIndex((t) => t.status === "upcoming");
  const movable = (t: Task) => t.status === "upcoming";
  const STATUS_TAG: Record<string, string> = { done: "Done", in_progress: "Now", skipped: "Skipped" };

  async function move(task: Task, delta: -1 | 1) {
    const ids = tasks.map((t) => t.id);
    const i = ids.indexOf(task.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    setError(null);
    try {
      await mutate("/tasks/order", "PUT", { taskIds: ids });
    } catch {
      setError("Couldn't move that task. Reload the page and try again.");
    }
  }

  // v1 events are single-stage: every task runs on the one stage, one after another.
  const toBody = (v: TaskValues) => ({ ...v, durationMinutes: Number(v.durationMinutes) });

  return (
    <section className="section" aria-labelledby="agenda-heading">
      <h2 id="agenda-heading">
        Agenda <span className="count">{tasks.length}</span>
      </h2>
      <Alert>{error}</Alert>

      {tasks.length > 0 && (
        <ol className="rows agenda">
          {tasks.map((task, index) =>
            editingId === task.id ? (
              <li key={task.id} className="row row-editing">
                <TaskForm
                  detail={detail}
                  initial={task}
                  submitLabel="Save task"
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (v) => {
                    await mutate(`/tasks/${task.id}`, "PATCH", toBody(v));
                    setEditingId(null);
                  }}
                />
              </li>
            ) : (
              <li key={task.id} className="row agenda-row agenda-item">
                <div className="agenda-line">
                <div className="agenda-time">
                  <strong>{formatTime(task.startAt, event.timezone)}</strong>
                  <span className="muted small">{formatTime(task.endAt, event.timezone)}</span>
                </div>
                <div className="row-main">
                  <strong>
                    {task.title}
                    {STATUS_TAG[task.status] && <span className={`task-tag task-${task.status}`}>{STATUS_TAG[task.status]}</span>}
                  </strong>
                  <span className="muted small">
                    {formatDuration(task.durationMinutes)}
                  </span>
                  {task.assigneeIds.length > 0 && (
                    <span className="small assignees">{task.assigneeIds.map(nameOf).join(", ")}</span>
                  )}
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className={`button button-small ${commentCount(task.id) ? "has-comments" : ""}`}
                    aria-expanded={openComments === task.id}
                    onClick={() => setOpenComments(openComments === task.id ? null : task.id)}
                  >
                    {commentCount(task.id) ? `Comments (${commentCount(task.id)})` : "Comment"}
                  </button>
                {permissions.canEdit && task.status !== "done" && task.status !== "skipped" && (
                  <>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Move ${task.title} up`}
                      disabled={!movable(task) || index === 0 || index <= firstMovable}
                      onClick={() => move(task, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Move ${task.title} down`}
                      disabled={!movable(task) || index === tasks.length - 1}
                      onClick={() => move(task, 1)}
                    >
                      ↓
                    </button>
                    <button type="button" className="button button-small" onClick={() => setEditingId(task.id)}>
                      Edit
                    </button>
                    {movable(task) && (
                      <button
                        type="button"
                        className="button button-small"
                        onClick={() => mutate(`/tasks/${task.id}`, "DELETE").catch(() => setError("Couldn't delete that task."))}
                      >
                        Delete
                      </button>
                    )}
                  </>
                )}
                </div>
                </div>
                {openComments === task.id && <TaskComments detail={detail} task={task} mutate={mutate} />}
              </li>
            ),
          )}
        </ol>
      )}

      {tasks.length === 0 && !permissions.canEdit && <p className="muted">No tasks yet.</p>}

      {permissions.canEdit &&
        (adding ? (
          <div className="card-panel">
            <h3>Add a task</h3>
            <TaskForm
              detail={detail}
              submitLabel="Add task"
              onCancel={tasks.length ? () => setAdding(false) : undefined}
              onSubmit={async (v) => {
                await mutate("/tasks", "POST", toBody(v));
              }}
              resetOnSubmit
            />
          </div>
        ) : (
          <button type="button" className="button button-auto" onClick={() => setAdding(true)}>
            + Add a task
          </button>
        ))}
    </section>
  );
}

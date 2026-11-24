import { Menu } from "@base-ui/react/menu";
import { Tabs } from "@base-ui/react/tabs";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { ApiError, STATUS_LABEL, api, type EventDetail, type Person } from "../../api";
import { AppShell, refreshComingUp } from "../../components/AppShell";
import { Alert } from "../../components/Form";
import { HelpTip } from "../../components/HelpTip";
import { Icon } from "../../components/Icon";
import { StatCard } from "../../components/StatCard";
import { formatClockLength, formatLongDate, formatTime, formatWhenWithZone } from "../../time";
import { useLiveEvent } from "../../useLiveEvent";
import { AgendaSection } from "./AgendaSection";
import { BroadcastAlerts, BroadcastPanel, useBroadcastSignal } from "./Broadcasts";
import { EventDetailsForm } from "./EventDetailsForm";
import { LiveNow } from "./LiveNow";
import { MyPart } from "./MyPart";
import { PeopleSection } from "./PeopleSection";
import { StatusRail } from "./StatusRail";
import { TaskComments } from "./TaskComments";

/** Runs an API call that returns the updated event, and reports errors. */
export type Mutate = (path: string, method: string, body?: unknown) => Promise<EventDetail & { [k: string]: unknown }>;

type Tab = "agenda" | "people" | "broadcasts" | "comments";

/** Every comment on the program, grouped under the item it's about. */
function CommentsTab({ detail, mutate }: { detail: EventDetail; mutate: Mutate }) {
  const withComments = detail.tasks.filter((t) => detail.comments.some((c) => c.taskId === t.id));
  if (withComments.length === 0) {
    return <p className="muted">No comments yet. Open an item's comment icon on the Agenda tab to start one.</p>;
  }
  return (
    <div className="comment-groups">
      {withComments.map((t) => (
        <section key={t.id} className="comment-group">
          <h3>{t.title}</h3>
          <TaskComments detail={detail} task={t} mutate={mutate} />
        </section>
      ))}
    </div>
  );
}

/** QR020 / QR021: an event's program — summary, agenda, people — with its status in the rail. */
export function EventEditor() {
  const { eventId = "" } = useParams();
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [tab, setTab] = useState<Tab>("agenda");

  const load = useCallback(() => {
    api<EventDetail>(`/events/${eventId}`)
      .then(setDetail)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Couldn't load this event."));
  }, [eventId]);
  useEffect(load, [load]);
  useEffect(() => setTab("agenda"), [eventId]);

  // The team's people list, for Who and for people's status (Approvers and Admins only).
  const [people, setPeople] = useState<Person[]>([]);
  const teamId = detail?.event.teamId;
  const canEdit = detail?.permissions.canEdit ?? false;
  const loadPeople = useCallback(() => {
    if (!teamId || !canEdit) return;
    api<{ people: Person[] }>(`/teams/${teamId}/people`)
      .then((r) => setPeople(r.people))
      .catch(() => undefined);
  }, [teamId, canEdit]);
  useEffect(loadPeople, [loadPeople]);

  // One live connection for the page: the live strip and broadcast alerts.
  const broadcastSignal = useBroadcastSignal();
  const liveActive = detail?.event.status === "approved" || detail?.event.status === "live";
  const live = useLiveEvent(eventId, liveActive, (msg) => {
    if (msg.type === "broadcast" || msg.type === "broadcasts-changed") broadcastSignal.bump();
    // Someone changed the plan: show the new one straight away.
    if (msg.type === "plan-changed") load();
  });

  const mutate: Mutate = useCallback(
    async (path, method, body) => {
      const res = await api<EventDetail & Record<string, unknown>>(`/events/${eventId}${path}`, { method, body: body ?? (method === "DELETE" ? undefined : {}) });
      setDetail(res);
      return res;
    },
    [eventId],
  );

  if (loadError) {
    return (
      <AppShell>
        <Link to="/admin" className="back-link">
          ← Events
        </Link>
        <Alert>{loadError}</Alert>
      </AppShell>
    );
  }
  if (!detail) {
    return (
      <AppShell>
        <p className="muted">Loading…</p>
      </AppShell>
    );
  }

  const { event, permissions, tasks, participants, comments } = detail;
  const tz = event.timezone;
  const agendaMinutes = tasks.reduce((n, t) => n + t.durationMinutes, 0);
  const withEmail = participants.filter((p) => p.email).length;
  const confirmed = participants.filter((p) => p.response === "acknowledged").length;
  const published = event.status === "approved" || event.status === "live" || event.status === "past";
  const showBroadcasts = (event.status === "approved" || event.status === "live") && permissions.canManage;
  const showSummary = permissions.canEdit || permissions.canManage;

  const rail = <StatusRail detail={detail} mutate={mutate} onEditDetails={() => setEditingDetails(true)} />;

  return (
    <AppShell rail={rail} railLined>
      {editingDetails ? (
        <section className="settings-section">
          <div className="section-head">
            <h2>Event details</h2>
          </div>
          <EventDetailsForm
            initial={event}
            timeZone={event.timezone}
            canChangeZone={false}
            startLocked={event.status === "live"}
            submitLabel="Save details"
            onCancel={() => setEditingDetails(false)}
            onSubmit={async (values) => {
              await mutate("", "PATCH", values);
              refreshComingUp();
              setEditingDetails(false);
            }}
          />
        </section>
      ) : (
        <header className="event-head">
          <div className="page-title-row">
            <h1>
              <span className="title-pre">Event:</span> {event.name}
            </h1>
            <div className="title-actions">
              {(event.status === "approved" || event.status === "live") && permissions.canRunLive && (
                <Link className="button button-secondary button-small" to={`/command/${event.id}`}>
                  <Icon name="play" size={13} /> Open live view
                </Link>
              )}
              {permissions.canEdit && (
                <Menu.Root>
                  <Menu.Trigger className="button button-secondary button-small button-icon" aria-label="More actions">
                    <Icon name="dots" />
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner sideOffset={6} align="end" className="popover-positioner">
                      <Menu.Popup className="menu">
                        <Menu.Item className="menu-item" onClick={() => setEditingDetails(true)}>
                          <Icon name="pencil" /> Edit details
                        </Menu.Item>
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
              )}
            </div>
          </div>
          <p className="event-meta">
            <span className={`status-pill status-${event.status}`}>{STATUS_LABEL[event.status]}</span>
            <span>
              {formatLongDate(event.startAt, tz)} · {formatWhenWithZone(event.startAt, event.endAt, tz, tasks.length > 0)}
            </span>
            {permissions.canEdit && (
              <button type="button" className="edit-link" onClick={() => setEditingDetails(true)}>
                <Icon name="pencil" size={13} /> Edit details
              </button>
            )}
          </p>
          {event.description && <p className="event-description">{event.description}</p>}
        </header>
      )}

      {event.status === "live" && detail.me.participant && <BroadcastAlerts eventId={event.id} version={broadcastSignal.version} />}
      <LiveNow detail={detail} live={live} onStatusChange={load} />
      <MyPart detail={detail} mutate={mutate} />

      {showSummary && (
        <section className="summary" aria-labelledby="summary-heading">
          <h2 id="summary-heading">Summary</h2>
          <div className="stat-grid">
            <StatCard
              title="Agenda length"
              caption={tasks.length ? `ends at ${formatTime(event.endAt, tz)}` : "add items to set the end time"}
              value={formatClockLength(agendaMinutes)}
              help={<HelpTip label="Agenda length">The items' durations added up. The event ends when its last item does.</HelpTip>}
            />
            <StatCard
              title="People"
              caption="with an email"
              value={withEmail}
              total={participants.length}
              ratio={participants.length ? withEmail / participants.length : 0}
              tone={participants.length === 0 ? "neutral" : withEmail === participants.length ? "good" : "warn"}
              help={<HelpTip label="People">Everyone chosen under Who needs an email before the program can go for review, so they can be sent their part.</HelpTip>}
            />
            <StatCard
              title="Replies"
              caption={published ? "confirmed they'll be there" : "after approval"}
              value={confirmed}
              total={participants.length}
              ratio={participants.length ? confirmed / participants.length : 0}
              tone={!published ? "neutral" : confirmed === participants.length && confirmed > 0 ? "good" : "warn"}
              help={<HelpTip label="Replies">Once approved, each person is emailed their part and asked to confirm.</HelpTip>}
            />
          </div>
        </section>
      )}

      <Tabs.Root value={tab} onValueChange={(v) => setTab(v as Tab)} className="tabs">
        <Tabs.List className="tab-list" aria-label="Program">
          <Tabs.Tab value="agenda" className="tab">
            Agenda <span className="count">{tasks.length}</span>
          </Tabs.Tab>
          <Tabs.Tab value="people" className="tab">
            People <span className="count">{participants.length}</span>
          </Tabs.Tab>
          {showBroadcasts && (
            <Tabs.Tab value="broadcasts" className="tab">
              Broadcasts
            </Tabs.Tab>
          )}
          <Tabs.Tab value="comments" className="tab">
            Comments {comments.length > 0 && <span className="count">{comments.length}</span>}
          </Tabs.Tab>
          <Tabs.Indicator className="tab-indicator" />
        </Tabs.List>
        <Tabs.Panel value="agenda" className="tab-panel">
          <AgendaSection detail={detail} mutate={mutate} people={people} reloadPeople={loadPeople} />
        </Tabs.Panel>
        <Tabs.Panel value="people" className="tab-panel">
          <PeopleSection detail={detail} mutate={mutate} people={people} reloadPeople={loadPeople} reloadEvent={load} />
        </Tabs.Panel>
        {showBroadcasts && (
          <Tabs.Panel value="broadcasts" className="tab-panel">
            <BroadcastPanel detail={detail} version={broadcastSignal.version} />
          </Tabs.Panel>
        )}
        <Tabs.Panel value="comments" className="tab-panel">
          <CommentsTab detail={detail} mutate={mutate} />
        </Tabs.Panel>
      </Tabs.Root>
    </AppShell>
  );
}

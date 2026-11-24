import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ApiError, STATUS_LABEL, api, type EventSummary } from "../../api";
import { useAuth } from "../../auth/AuthContext";
import { AppShell } from "../../components/AppShell";
import { Alert } from "../../components/Form";
import { Icon } from "../../components/Icon";
import { Notice } from "../../components/Notice";
import { storage } from "../../storage";
import { dateTile, formatDayMonth, formatTime, formatTimeRange, relativeDay } from "../../time";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function EventRow({ e }: { e: EventSummary }) {
  const tile = dateTile(e.startAt, e.timezone);
  const past = e.status === "past";
  return (
    <li>
      <Link className="list-row" to={`/admin/events/${e.id}`}>
        <span className="date-tile" aria-hidden="true">
          <b>{tile.day}</b>
          {tile.month}
        </span>
        <span className="list-main">
          <span className="list-name">{e.name}</span>
          <span className="list-sub">
            {formatDayMonth(e.startAt, e.timezone)} · {e.taskCount ? formatTimeRange(e.startAt, e.endAt, e.timezone) : formatTime(e.startAt, e.timezone)} · {plural(e.taskCount, "item")} ·{" "}
            {plural(e.participantCount, "person", "people")}
          </span>
        </span>
        <span className="list-meta">
          {past ? (
            <span className="list-status">
              <Icon name="check" className="tone-good-text" /> Ended
            </span>
          ) : (
            <span className={`status-pill status-${e.status}`}>{STATUS_LABEL[e.status]}</span>
          )}
          <span>{relativeDay(e.startAt, e.timezone)}</span>
        </span>
      </Link>
    </li>
  );
}

/** Start and end of this week (Monday to Sunday) in the viewer's time. */
function thisWeek(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

/** The team's events: what needs you, what's coming up, and what's done. */
export function EventsList() {
  const { currentTeam } = useAuth();
  const [data, setData] = useState<{ canCreate: boolean; events: EventSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      return JSON.parse(storage.get("qrono.dismissedApprovals") ?? "[]");
    } catch {
      return [];
    }
  });

  useEffect(() => {
    setData(null);
    api<{ canCreate: boolean; events: EventSummary[] }>(`/teams/${currentTeam!.id}/events`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load events."));
  }, [currentTeam]);

  const events = data?.events ?? [];
  const upcoming = events.filter((e) => e.status !== "past");
  const past = events.filter((e) => e.status === "past").reverse();
  const waiting = events.filter((e) => e.awaitingMyApproval && !dismissed.includes(e.id));
  const week = thisWeek();
  const thisWeeksEvents = upcoming.filter((e) => Date.parse(e.startAt) >= week.start.getTime() && Date.parse(e.startAt) < week.end.getTime());
  const missingEmails = upcoming.reduce((n, e) => n + e.missingEmailCount, 0);
  const inReview = upcoming.filter((e) => e.status === "review").length;

  const dismiss = () => {
    const next = [...dismissed, ...waiting.map((e) => e.id)];
    setDismissed(next);
    storage.set("qrono.dismissedApprovals", JSON.stringify(next));
  };

  const rail = data && (
    <>
      <section className="panel" aria-labelledby="week-heading">
        <h2 id="week-heading">This week</h2>
        <p className="panel-sub">
          {formatDayMonth(week.start.toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone)} –{" "}
          {formatDayMonth(new Date(week.end.getTime() - 1).toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone)}
        </p>
        <ul className="kv-list">
          <li>
            <b className="tone-good-text">{thisWeeksEvents.length}</b> {thisWeeksEvents.length === 1 ? "event" : "events"}
          </li>
          <li>
            <b className={inReview ? "tone-warn-text" : undefined}>{inReview}</b> {inReview === 1 ? "program" : "programs"} in review
          </li>
          {data.canCreate && (
            <li>
              <b className={missingEmails ? "tone-bad-text" : undefined}>{missingEmails}</b> {missingEmails === 1 ? "person needs" : "people need"} an email
            </li>
          )}
        </ul>
      </section>
      {data.canCreate && (
        <section className="panel" aria-labelledby="faster-heading">
          <h2 id="faster-heading">Start faster</h2>
          <p className="panel-sub">A new event can copy the agenda of any past program. Create it, then choose “add from a template”.</p>
          <Link className="button button-secondary" to="/admin/events/new">
            <Icon name="copy" /> New event from a template
          </Link>
        </section>
      )}
    </>
  );

  return (
    <AppShell rail={rail}>
      <div className="page-title-row">
        <h1>Events</h1>
        {data?.canCreate && (
          <Link className="button button-primary button-auto" to="/admin/events/new">
            <Icon name="plus" /> New event
          </Link>
        )}
      </div>
      <Alert>{error}</Alert>

      {waiting.length > 0 && (
        <Notice
          title={`${plural(waiting.length, "program is", "programs are")} waiting for your approval`}
          action={
            <button type="button" className="button button-soft" onClick={dismiss}>
              Dismiss
            </button>
          }
        >
          {waiting.map((e, i) => (
            <span key={e.id}>
              {i > 0 && ", "}
              <Link className="text-link" to={`/admin/events/${e.id}`}>
                {e.name} on {formatDayMonth(e.startAt, e.timezone)}
              </Link>
            </span>
          ))}
        </Notice>
      )}

      {!data && !error && <p className="muted">Loading…</p>}
      {data && events.length === 0 && (
        <section className="settings-section">
          <div className="section-head">
            <h2>No events yet</h2>
          </div>
          <p>{data.canCreate ? "Create your first event, then build its agenda and choose who runs each part." : "Events you're part of will appear here."}</p>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="settings-section" aria-labelledby="upcoming-heading">
          <div className="section-head">
            <h2 id="upcoming-heading">Upcoming</h2>
            <span className="count">{upcoming.length}</span>
          </div>
          <ul className="list">
            {upcoming.map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
          </ul>
        </section>
      )}

      {past.length > 0 && (
        <section className="settings-section" aria-labelledby="past-heading">
          <div className="section-head">
            <h2 id="past-heading">Past</h2>
            <span className="count">{past.length}</span>
          </div>
          <ul className="list">
            {past.map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ApiError, STATUS_LABEL, api, type EventSummary } from "../../api";
import { useAuth } from "../../auth/AuthContext";
import { AppShell } from "../../components/AppShell";
import { Alert } from "../../components/Form";
import { formatRange } from "../../time";

/** The team's events, soonest first. */
export function EventsList() {
  const { currentTeam } = useAuth();
  const [data, setData] = useState<{ canCreate: boolean; events: EventSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api<{ canCreate: boolean; events: EventSummary[] }>(`/teams/${currentTeam!.id}/events`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load events."));
  }, [currentTeam]);

  return (
    <AppShell>
      <div className="page-header">
        <h1>Events</h1>
        {data?.canCreate && (
          <Link className="button button-primary button-auto" to="/admin/events/new">
            New event
          </Link>
        )}
      </div>
      <Alert>{error}</Alert>
      {!data && !error && <p className="muted">Loading…</p>}
      {data && data.events.length === 0 && (
        <section className="placeholder">
          <p>No events yet.</p>
          <p className="muted small">
            {data.canCreate
              ? "Create your first event, then build its agenda and add the people running it."
              : "Events you're part of will appear here."}
          </p>
        </section>
      )}
      {data && data.events.length > 0 && (
        <ul className="rows">
          {data.events.map((e) => (
            <li key={e.id} className="row">
              <Link className="row-main row-link" to={`/admin/events/${e.id}`}>
                <strong>{e.name}</strong>
                <span className="muted small">{formatRange(e.startAt, e.endAt, e.timezone)}</span>
              </Link>
              <div className="row-actions">
                <span className="muted small">
                  {e.taskCount} task{e.taskCount === 1 ? "" : "s"} · {e.participantCount} {e.participantCount === 1 ? "person" : "people"}
                </span>
                <span className={`status-pill status-${e.status}`}>{STATUS_LABEL[e.status]}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}

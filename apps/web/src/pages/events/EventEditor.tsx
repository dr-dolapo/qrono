import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, STATUS_LABEL, api, type EventDetail } from "../../api";
import { AppShell } from "../../components/AppShell";
import { Alert } from "../../components/Form";
import { formatDuration, formatRange, formatTime } from "../../time";
import { AgendaSection } from "./AgendaSection";
import { EventDetailsForm } from "./EventDetailsForm";
import { MyPart } from "./MyPart";
import { PeopleSection } from "./PeopleSection";
import { ReviewPanel } from "./ReviewPanel";

/** Runs an API call that returns the updated event, and reports errors. */
export type Mutate = (path: string, method: string, body?: unknown) => Promise<EventDetail & { [k: string]: unknown }>;

/** QR020 / QR021: build a draft event — details, agenda and people. Single-stage in v1. */
export function EventEditor() {
  const { eventId = "" } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<EventDetail>(`/events/${eventId}`)
      .then(setDetail)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Couldn't load this event."));
  }, [eventId]);

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
        <Link to="/admin" className="muted small">← Events</Link>
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

  const { event, permissions, schedule } = detail;
  const tz = event.timezone;

  return (
    <AppShell>
      <Link to="/admin" className="muted small">
        ← Events
      </Link>

      {editingDetails ? (
        <div className="card-panel">
          <h2>Event details</h2>
          <EventDetailsForm
            initial={event}
            submitLabel="Save details"
            onCancel={() => setEditingDetails(false)}
            onSubmit={async (values) => {
              await mutate("", "PATCH", values);
              setEditingDetails(false);
            }}
          />
        </div>
      ) : (
        <header className="event-header">
          <div>
            <div className="event-title-row">
              <h1>{event.name}</h1>
              <span className={`status-pill status-${event.status}`}>{STATUS_LABEL[event.status]}</span>
            </div>
            <p className="event-when">{formatRange(event.startAt, event.endAt, tz)}</p>
            <p className="muted small">Times in {tz.replace(/_/g, " ")}</p>
            {event.description && <p className="event-description">{event.description}</p>}
          </div>
          {permissions.canEdit && (
            <div className="button-row">
              <button type="button" className="button button-small" onClick={() => setEditingDetails(true)}>
                Edit details
              </button>
              {confirmDelete ? (
                <>
                  <button
                    type="button"
                    className="button button-small button-danger"
                    onClick={async () => {
                      try {
                        await api(`/events/${eventId}`, { method: "DELETE" });
                        navigate("/admin", { replace: true });
                      } catch (err) {
                        setError(err instanceof ApiError ? err.message : "Couldn't delete the event.");
                      }
                    }}
                  >
                    Yes, delete draft
                  </button>
                  <button type="button" className="button button-small" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className="button button-small" onClick={() => setConfirmDelete(true)}>
                  Delete draft
                </button>
              )}
            </div>
          )}
        </header>
      )}

      <Alert>{error}</Alert>
      <ReviewPanel detail={detail} mutate={mutate} />

      <div className="summary-strip">
        <div>
          <span className="muted small">Agenda</span>
          <strong>
            {detail.tasks.length} task{detail.tasks.length === 1 ? "" : "s"}
          </strong>
        </div>
        <div>
          <span className="muted small">Agenda ends</span>
          <strong>{detail.tasks.length ? formatTime(schedule.endsAt, tz) : "—"}</strong>
        </div>
        <div>
          <span className="muted small">People</span>
          <strong>{detail.participants.length}</strong>
        </div>
        <div>
          <span className="muted small">Moving to the next task</span>
          {permissions.canEdit ? (
            <select
              aria-label="Moving to the next task"
              value={event.progressionMode}
              onChange={(e) => mutate("", "PATCH", { progressionMode: e.target.value }).catch(() => setError("Couldn't save that setting."))}
            >
              <option value="manual">Manually, by an Admin</option>
              <option value="auto">Automatically, on time</option>
            </select>
          ) : (
            <strong>{event.progressionMode === "auto" ? "Automatic" : "Manual"}</strong>
          )}
        </div>
      </div>

      {schedule.overrunMinutes > 0 && (
        <Alert kind="error">
          The agenda ends at {formatTime(schedule.endsAt, tz)}, {formatDuration(schedule.overrunMinutes)} after the event's end time (
          {formatTime(event.endAt, tz)}). Shorten some tasks or change the end time.
        </Alert>
      )}

      <MyPart detail={detail} mutate={mutate} />
      <AgendaSection detail={detail} mutate={mutate} />
      <PeopleSection detail={detail} mutate={mutate} />
    </AppShell>
  );
}

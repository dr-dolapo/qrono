import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { ApiError, api, type EventDetail } from "../api";
import { useClock } from "../useClock";
import { formatCountdown, liveView, useLiveEvent, type LiveState } from "../useLiveEvent";
import { formatTime } from "../time";

/**
 * The command centre: run full screen on a laptop connected to the HDMI
 * screen facing the stage and backstage (PRD §1.1). The audience may glimpse
 * it, so it shows the run of show only — never comments or private notes.
 *
 * Keyboard: → or PageDown moves to the next task (works with presenter clickers).
 */
export function CommandCentre() {
  const { eventId = "" } = useParams();
  const [denied, setDenied] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const { connection, state, setState, clockOffset } = useLiveEvent(eventId, checked && !denied);
  const tick = useClock();
  const now = tick.getTime() + clockOffset;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);

  // Only Approvers and Admins run the event.
  useEffect(() => {
    api<EventDetail>(`/events/${eventId}`)
      .then((d) => {
        if (!d.permissions.canManage) setDenied("Only Approvers and Admins can open the command centre.");
        else if (d.event.status === "draft" || d.event.status === "review") setDenied("This event isn't approved yet.");
      })
      .catch((err) => setDenied(err instanceof ApiError ? err.message : "Couldn't open this event."))
      .finally(() => setChecked(true));
  }, [eventId]);

  const command = useCallback(
    async (action: "start" | "next" | "end") => {
      setBusy(true);
      setError(null);
      try {
        const next = await api<LiveState>(`/events/${eventId}/live/${action}`, { method: "POST", body: {} });
        setState(next);
        setConfirmEnd(false);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "That didn't go through. Check the connection.");
      } finally {
        setBusy(false);
      }
    },
    [eventId, setState],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "ArrowRight" || e.key === "PageDown") && state?.event.status === "live" && !busy) {
        e.preventDefault();
        void command("next");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [command, state?.event.status, busy]);

  if (denied) {
    return (
      <main className="command command-message">
        <p className="brand">Qrono</p>
        <p>{denied}</p>
        <Link to={`/admin/events/${eventId}`}>Back to the event</Link>
      </main>
    );
  }
  if (!state) {
    return (
      <main className="command command-message" aria-busy="true">
        <p className="brand">Qrono</p>
        <p className="muted">Connecting…</p>
      </main>
    );
  }

  const { event } = state;
  const tz = event.timezone;
  const view = liveView(state, now);
  const overrun = view.remainingMs !== null && view.remainingMs < 0;
  const startsIn = Date.parse(event.startAt) - now;
  const isLastTask = event.status === "live" && view.current && !view.next;

  return (
    <main className={`command ${overrun ? "command-overrun" : ""}`}>
      <header className="command-bar">
        <span className="brand">Qrono</span>
        <span className="command-event">{event.name}</span>
        <span className={`status status-${connection}`}>{connection === "connected" ? "Connected" : connection === "connecting" ? "Connecting" : "Reconnecting…"}</span>
        <span className="command-bar-spacer" />
        <button type="button" className="command-small" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)}>
          Full screen
        </button>
        <Link className="command-small" to={`/admin/events/${eventId}`}>
          Exit
        </Link>
      </header>

      <section className="command-clock" aria-label="Current time">
        {new Date(now).toLocaleTimeString([], { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </section>

      {event.status === "approved" && (
        <section className="command-status">
          {startsIn > 0 ? (
            <>
              Starts in <strong>{formatCountdown(startsIn)}</strong> at {formatTime(event.startAt, tz)}
            </>
          ) : (
            "Starting…"
          )}
        </section>
      )}
      {event.status === "past" && <section className="command-status">The event has ended.</section>}

      <section className="command-grid">
        <div className={`command-panel command-now ${overrun ? "is-overrun" : ""}`}>
          <h2>{event.status === "approved" ? "First up" : "Now"}</h2>
          {event.status === "live" && view.current ? (
            <>
              <p className="command-task">{view.current.title}</p>
              {view.current.assignees.length > 0 && <p className="command-people">{view.current.assignees.join(" · ")}</p>}
              <p className={`command-countdown ${overrun ? "over" : view.remainingMs! < 60_000 ? "soon" : ""}`}>
                {overrun ? `+${formatCountdown(view.remainingMs!)} over` : `${formatCountdown(view.remainingMs!)} left`}
              </p>
              <div className="command-progress" aria-hidden="true" key={view.current.id}>
                <div style={{ width: `${Math.round(view.progress * 100)}%` }} />
              </div>
            </>
          ) : event.status === "approved" && view.next ? (
            <>
              <p className="command-task">{view.next.title}</p>
              {view.next.assignees.length > 0 && <p className="command-people">{view.next.assignees.join(" · ")}</p>}
            </>
          ) : (
            <p className="command-task muted">{event.status === "past" ? "—" : "All tasks are done"}</p>
          )}
        </div>

        <div className="command-panel">
          <h2>Up next</h2>
          {event.status === "live" && view.next ? (
            <>
              <p className="command-next">{view.next.title}</p>
              {view.next.assignees.length > 0 && <p className="command-people small-people">{view.next.assignees.join(" · ")}</p>}
              {view.nextExpectedAt && <p className="muted">around {formatTime(new Date(view.nextExpectedAt).toISOString(), tz)}</p>}
            </>
          ) : (
            <p className="command-next muted">{event.status === "approved" ? (state.tasks[1]?.title ?? "—") : "—"}</p>
          )}
          {event.status === "live" && view.later.length > 0 && (
            <ol className="command-later">
              {view.later.map((t) => (
                <li key={t.id}>{t.title}</li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <footer className="command-controls">
        {error && <p className="command-error" role="alert">{error}</p>}
        {confirmEnd ? (
          <div className="command-confirm" role="alertdialog" aria-label="End the event?">
            <span>End the event now? Tasks that haven't run will be marked skipped, and guests' links will stop working.</span>
            <button type="button" className="button button-danger button-auto" disabled={busy} onClick={() => command("end")}>
              End event
            </button>
            <button type="button" className="button button-auto" onClick={() => setConfirmEnd(false)}>
              Keep going
            </button>
          </div>
        ) : (
          <>
            {event.status === "approved" && (
              <button type="button" className="button button-primary button-auto command-main" disabled={busy} onClick={() => command("start")}>
                Start event now
              </button>
            )}
            {event.status === "live" && (view.current || view.next) && (
              <button type="button" className="button button-primary button-auto command-main" disabled={busy} onClick={() => command("next")}>
                {isLastTask ? "Finish last task" : "Next task →"}
              </button>
            )}
            {(event.status === "live" || event.status === "approved") && (
              <button type="button" className="button button-auto" disabled={busy} onClick={() => setConfirmEnd(true)}>
                End event
              </button>
            )}
            {event.status === "live" && (
              <span className="muted command-mode">{event.progressionMode === "auto" ? "Moves on automatically when time is up" : "You move to the next task"}</span>
            )}
          </>
        )}
      </footer>
    </main>
  );
}

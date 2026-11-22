import { useEffect } from "react";
import type { EventDetail } from "../../api";
import { useClock } from "../../useClock";
import { formatCountdown, liveView, useLiveEvent } from "../../useLiveEvent";

/**
 * QR023–QR025 on the web: while an event is approved or live, everyone on it
 * sees what's happening now and what's next, updated live.
 */
export function LiveNow({ detail, onStatusChange }: { detail: EventDetail; onStatusChange: () => void }) {
  const active = detail.event.status === "approved" || detail.event.status === "live";
  const { state, connection, clockOffset } = useLiveEvent(detail.event.id, active);
  const now = useClock().getTime() + clockOffset;

  // When the room says the status changed (went live, ended), refresh the page's data.
  const liveStatus = state?.event.status;
  useEffect(() => {
    if (liveStatus && liveStatus !== detail.event.status) onStatusChange();
  }, [liveStatus, detail.event.status, onStatusChange]);

  if (!active || !state) return null;
  const view = liveView(state, now);
  const mineIds = new Set(detail.me.participant ? detail.tasks.filter((t) => t.assigneeIds.includes(detail.me.participant!.id)).map((t) => t.id) : []);

  if (state.event.status === "approved") {
    const startsIn = Date.parse(state.event.startAt) - now;
    return (
      <section className="live-now" aria-live="polite">
        <span className="live-label">Starts in</span>
        <strong className="live-countdown">{startsIn > 0 ? formatCountdown(startsIn) : "a moment"}</strong>
        {connection !== "connected" && <span className="muted small"> · reconnecting…</span>}
      </section>
    );
  }

  const overrun = view.remainingMs !== null && view.remainingMs < 0;
  return (
    <section className="live-now is-live" aria-live="polite">
      <div>
        <span className="live-label">
          <span className="live-dot" /> Live now
        </span>
        <strong className="live-title">
          {view.current ? view.current.title : "All tasks are done"}
          {view.current && mineIds.has(view.current.id) && <span className="badge"> You</span>}
        </strong>
        {view.current && (
          <span className={`small ${overrun ? "live-over" : "muted"}`}>
            {overrun ? `${formatCountdown(view.remainingMs!)} over time` : `${formatCountdown(view.remainingMs!)} left`}
          </span>
        )}
      </div>
      {view.next && (
        <div>
          <span className="live-label">Up next</span>
          <strong>
            {view.next.title}
            {mineIds.has(view.next.id) && <span className="badge"> You</span>}
          </strong>
        </div>
      )}
      {connection !== "connected" && <span className="muted small">Reconnecting…</span>}
    </section>
  );
}

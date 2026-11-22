import { useParams } from "react-router";
import { formatClock, useClock } from "../useClock";
import { useLiveEvent } from "../useLiveEvent";

/**
 * The command centre, shown full screen on an HDMI display facing the stage
 * and backstage. The audience may glimpse it, so it shows only the run of
 * show — never comments or private notes (PRD §1.1).
 */
export function CommandCentre() {
  const { eventId } = useParams();
  const now = useClock();
  const { connection } = useLiveEvent(eventId);

  return (
    <main className="command">
      <header className="command-bar">
        <span className="brand">Qrono</span>
        <span className={`status status-${connection}`}>{connection}</span>
      </header>

      <section className="command-clock" aria-label="Current time">
        {formatClock(now)}
      </section>

      <section className="command-grid">
        <div className="command-panel">
          <h2>Now</h2>
          <p className="command-task">—</p>
          <p className="muted">The agenda appears here once the event is live.</p>
        </div>
        <div className="command-panel">
          <h2>Up next</h2>
          <p className="command-task">—</p>
        </div>
      </section>
    </main>
  );
}

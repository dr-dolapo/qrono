import { Link } from "react-router";
import { AppShell } from "../components/AppShell";

/** The Admin & Approver area (web only). Events are next. */
export function AdminHome() {
  return (
    <AppShell>
      <h1>Events</h1>
      <section className="placeholder">
        <p>No events yet.</p>
        <p className="muted small">
          Creating events and building the agenda are coming next. Meanwhile, <Link to="/admin/team">invite your team</Link>.
        </p>
      </section>
    </AppShell>
  );
}

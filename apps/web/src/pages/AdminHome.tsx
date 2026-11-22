import { useNavigate } from "react-router";
import type { Role } from "../api";
import { useAuth } from "../auth/AuthContext";

const ROLE_LABEL: Record<Role, string> = { approver: "Approver", admin: "Admin", member: "Member" };

/** The Admin & Approver area (web only). Events and team management are next. */
export function AdminHome() {
  const { user, teams, logout } = useAuth();
  const navigate = useNavigate();
  const team = teams[0];

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="brand">Qrono</span>
        {team && (
          <span className="topbar-team">
            {team.name} <span className="badge">{ROLE_LABEL[team.role]}</span>
          </span>
        )}
        <span className="topbar-spacer" />
        <span className="muted small">
          {user?.firstName} {user?.lastName}
        </span>
        <button
          type="button"
          className="button button-small"
          onClick={async () => {
            await logout();
            navigate("/login", { replace: true });
          }}
        >
          Log out
        </button>
      </header>

      <main className="page">
        <h1>Events</h1>
        <section className="placeholder">
          <p>No events yet.</p>
          <p className="muted small">
            Creating events, building the agenda, and inviting your team are coming next.
          </p>
        </section>
      </main>
    </div>
  );
}

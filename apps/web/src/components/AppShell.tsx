import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";
import { ROLE_LABEL } from "../api";
import { useAuth } from "../auth/AuthContext";

/** Top bar + navigation for the signed-in admin area. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, teams, currentTeam, setCurrentTeam, logout } = useAuth();
  const navigate = useNavigate();
  const activeTeams = teams.filter((t) => t.status === "active");

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="brand">Qrono</span>
        {currentTeam &&
          (activeTeams.length > 1 ? (
            <label className="team-switcher">
              <span className="visually-hidden">Team</span>
              <select value={currentTeam.id} onChange={(e) => setCurrentTeam(e.target.value)}>
                {activeTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="topbar-team">{currentTeam.name}</span>
          ))}
        {currentTeam && <span className="badge">{ROLE_LABEL[currentTeam.role]}</span>}
        <nav className="topnav" aria-label="Main">
          <NavLink to="/admin" end>
            Events
          </NavLink>
          <NavLink to="/admin/team">Team</NavLink>
        </nav>
        <span className="topbar-spacer" />
        <span className="muted small topbar-user">
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
      <main className="page page-wide">{children}</main>
    </div>
  );
}

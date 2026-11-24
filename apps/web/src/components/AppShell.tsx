import type { ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { ROLE_LABEL } from "../api";
import { useAuth } from "../auth/AuthContext";
import { Logo } from "./Logo";

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5" />
      <path d="M16 5.2a3.3 3.3 0 0 1 0 6.6M18 14.8c1.9.7 3.1 2.5 3.5 5.2" />
    </svg>
  );
}

/** Sidebar navigation for the signed-in admin area. On phones it folds into a top bar. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, teams, currentTeam, setCurrentTeam, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeTeams = teams.filter((t) => t.status === "active");
  const onTeamPage = pathname.startsWith("/admin/team");

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/admin" className="sidebar-logo" aria-label="Qrono home">
          <Logo />
        </Link>

        {currentTeam && (
          <div className="sidebar-team">
            {activeTeams.length > 1 ? (
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
              <span className="sidebar-team-name">{currentTeam.name}</span>
            )}
            <span className="badge">{ROLE_LABEL[currentTeam.role]}</span>
          </div>
        )}

        <nav className="sidenav" aria-label="Main">
          <NavLink to="/admin" className={() => (onTeamPage ? "" : "active")} aria-current={onTeamPage ? undefined : "page"}>
            <CalendarIcon />
            Events
          </NavLink>
          <NavLink to="/admin/team">
            <PeopleIcon />
            Team
          </NavLink>
        </nav>

        <div className="sidebar-user">
          <span className="sidebar-avatar" aria-hidden="true">
            {user?.firstName?.[0]}
            {user?.lastName?.[0]}
          </span>
          <span className="sidebar-user-name">
            {user?.firstName} {user?.lastName}
          </span>
          <button
            type="button"
            className="button button-small button-ghost"
            onClick={async () => {
              await logout();
              navigate("/login", { replace: true });
            }}
          >
            Log out
          </button>
        </div>
      </aside>
      <main className="page page-wide app-main">{children}</main>
    </div>
  );
}

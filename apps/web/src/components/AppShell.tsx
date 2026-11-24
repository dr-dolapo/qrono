import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import clsx from "clsx";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate, useParams } from "react-router";
import { ROLE_LABEL, api, type EventSummary } from "../api";
import { useAuth } from "../auth/AuthContext";
import { dateTile, formatTime, formatTimeRange } from "../time";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { Logo } from "./Logo";

/** Upcoming events for the sidebar, kept per team so moving between pages doesn't refetch. */
const comingUpCache = new Map<string, EventSummary[]>();
let comingUpVersion = 0;
/** Call after creating, editing or deleting an event so the sidebar list refreshes. */
export function refreshComingUp() {
  comingUpCache.clear();
  comingUpVersion++;
  window.dispatchEvent(new Event("qrono:events-changed"));
}

function useComingUp(teamId: string | undefined, enabled: boolean) {
  const [events, setEvents] = useState<EventSummary[]>(() => (teamId ? (comingUpCache.get(teamId) ?? []) : []));
  const [version, setVersion] = useState(comingUpVersion);
  useEffect(() => {
    const bump = () => setVersion(comingUpVersion);
    window.addEventListener("qrono:events-changed", bump);
    return () => window.removeEventListener("qrono:events-changed", bump);
  }, []);
  useEffect(() => {
    if (!teamId || !enabled) return;
    const cached = comingUpCache.get(teamId);
    if (cached) {
      setEvents(cached);
      return;
    }
    let cancelled = false;
    api<{ events: EventSummary[] }>(`/teams/${teamId}/events`)
      .then((r) => {
        const upcoming = r.events.filter((e) => e.status !== "past" && Date.parse(e.endAt) > Date.now()).slice(0, 3);
        comingUpCache.set(teamId, upcoming);
        if (!cancelled) setEvents(upcoming);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [teamId, enabled, version]);
  return events;
}

function HelpMenu() {
  return (
    <Popover.Root>
      <Popover.Trigger className="top-link">
        <Icon name="help" /> Help
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" className="popover-positioner">
          <Popover.Popup className="popover popover-wide">
            <Popover.Title className="popover-title">How Qrono works</Popover.Title>
            <ol className="help-steps">
              <li><strong>Plan.</strong> Create an event, then add each item: what, how long, and who.</li>
              <li><strong>Review.</strong> Send the program to an Approver. Nobody is emailed yet.</li>
              <li><strong>Approve.</strong> Everyone on the program gets their part by email, and anyone new is invited to the team.</li>
              <li><strong>Run it.</strong> Open the live view or command centre on the day to move through the items.</li>
            </ol>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The signed-in admin area: a top bar (logo, help, team, account), a sidebar of
 * navigation and the next few events, the page, and an optional right rail.
 */
export function AppShell({ children, rail, railLined = false }: { children: ReactNode; rail?: ReactNode; railLined?: boolean }) {
  const { user, teams, currentTeam, setCurrentTeam, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { eventId } = useParams();
  const activeTeams = teams.filter((t) => t.status === "active");
  const onPeoplePage = pathname.startsWith("/admin/people");
  const onSettingsPage = pathname.startsWith("/admin/settings");
  const comingUp = useComingUp(currentTeam?.id, !!currentTeam);
  const fullName = `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim();

  const teamPill = (
    <>
      <Icon name="people" /> <span className="team-pill-name">{currentTeam?.name}</span>
      {activeTeams.length > 1 && <Icon name="chevron" size={14} />}
    </>
  );

  return (
    <div className="app-frame">
      <header className="topbar">
        <Link to="/admin" className="topbar-logo" aria-label="Qrono home">
          <Logo size={26} />
        </Link>
        <span className="topbar-grow" />
        <HelpMenu />
        {currentTeam &&
          (activeTeams.length > 1 ? (
            <Menu.Root>
              <Menu.Trigger className="team-pill" aria-label={`Team: ${currentTeam.name}. Switch team`}>
                {teamPill}
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner sideOffset={6} align="end" className="popover-positioner">
                  <Menu.Popup className="menu">
                    {activeTeams.map((t) => (
                      <Menu.Item key={t.id} className="menu-item" onClick={() => setCurrentTeam(t.id)}>
                        <span>{t.name}</span>
                        {t.id === currentTeam.id && <Icon name="check" />}
                      </Menu.Item>
                    ))}
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          ) : (
            <span className="team-pill">{teamPill}</span>
          ))}
        <Menu.Root>
          <Menu.Trigger className="avatar-button" aria-label={`Account: ${fullName}`}>
            <Avatar name={fullName || "?"} size={30} />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner sideOffset={6} align="end" className="popover-positioner">
              <Menu.Popup className="menu">
                <div className="menu-head">
                  <strong>{fullName}</strong>
                  <span>{user?.email}</span>
                </div>
                <Menu.Item
                  className="menu-item"
                  onClick={async () => {
                    await logout();
                    navigate("/login", { replace: true });
                  }}
                >
                  <Icon name="logout" /> Log out
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </header>

      <div className={clsx("app-shell", rail && "has-rail")}>
        <nav className="sidebar" aria-label="Main">
          {currentTeam && (
            <p className="side-label">
              {currentTeam.name} · {ROLE_LABEL[currentTeam.role]}
            </p>
          )}
          <NavLink to="/admin" className={() => clsx("side-nav", !onPeoplePage && !onSettingsPage && !eventId && "active")} end>
            <Icon name="calendar" size={18} /> Events
          </NavLink>
          <NavLink to="/admin/people" className={() => clsx("side-nav", onPeoplePage && "active")}>
            <Icon name="people" size={18} /> People
          </NavLink>

          {comingUp.length > 0 && (
            <>
              <hr />
              <p className="side-label">Coming up</p>
              {comingUp.map((e) => {
                const tile = dateTile(e.startAt, e.timezone);
                return (
                  <Link key={e.id} to={`/admin/events/${e.id}`} className={clsx("side-event", e.id === eventId && "active")}>
                    <span className="date-tile date-tile-sm" aria-hidden="true">
                      <b>{tile.day}</b>
                      {tile.month}
                    </span>
                    <span className="side-event-text">
                      <span className="side-event-name">{e.name}</span>
                      <span className="side-event-meta">
                        <span className="visually-hidden">
                          {tile.day} {tile.month},{" "}
                        </span>
                        {e.taskCount ? formatTimeRange(e.startAt, e.endAt, e.timezone) : formatTime(e.startAt, e.timezone)}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </>
          )}

          {currentTeam && (
            <div className="side-bottom">
              <NavLink to="/admin/settings" className={() => clsx("side-nav", onSettingsPage && "active")}>
                <Icon name="settings" size={18} /> Settings
              </NavLink>
            </div>
          )}
        </nav>

        <main className="app-main">
          <div className="app-column">{children}</div>
        </main>
        {rail && <aside className={clsx("app-rail", railLined && "app-rail-lined")}>{rail}</aside>}
      </div>
    </div>
  );
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api, type TeamSummary, type User } from "../api";
import { storage } from "../storage";
import { setClockFormat } from "../time";

interface AuthState {
  /** undefined while the first check is in flight. */
  user: User | null | undefined;
  /** Every team the user is on, including join requests waiting for approval. */
  teams: TeamSummary[];
  /** The team the admin area is showing (an active membership), if any. */
  currentTeam: TeamSummary | null;
  setCurrentTeam: (teamId: string) => void;
  refresh: () => Promise<void>;
  setUser: (user: User) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const CURRENT_TEAM_KEY = "qrono.currentTeam";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null | undefined>(undefined);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [currentTeamId, setCurrentTeamId] = useState<string | null>(() => storage.get(CURRENT_TEAM_KEY));

  const refresh = useCallback(async () => {
    try {
      const me = await api<{ user: User; teams: TeamSummary[] }>("/auth/me");
      setUserState(me.user);
      setTeams(me.teams);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUserState(null);
        setTeams([]);
      } else {
        // Network trouble: keep whatever we had, but stop showing the loading state.
        setUserState((u) => (u === undefined ? null : u));
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
    setUserState(null);
    setTeams([]);
  }, []);

  const setCurrentTeam = useCallback((teamId: string) => {
    setCurrentTeamId(teamId);
    storage.set(CURRENT_TEAM_KEY, teamId);
  }, []);

  const currentTeam = useMemo(() => {
    const active = teams.filter((t) => t.status === "active");
    return active.find((t) => t.id === currentTeamId) ?? active[0] ?? null;
  }, [teams, currentTeamId]);

  const value = useMemo<AuthState>(
    () => ({ user, teams, currentTeam, setCurrentTeam, refresh, setUser: setUserState, logout }),
    [user, teams, currentTeam, setCurrentTeam, refresh, logout],
  );
  // Times everywhere follow the current team's 12/24-hour setting.
  setClockFormat(currentTeam?.clockFormat);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api, type TeamSummary, type User } from "../api";

interface AuthState {
  /** undefined while the first check is in flight. */
  user: User | null | undefined;
  teams: TeamSummary[];
  refresh: () => Promise<void>;
  setUser: (user: User) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null | undefined>(undefined);
  const [teams, setTeams] = useState<TeamSummary[]>([]);

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

  const value = useMemo<AuthState>(
    () => ({ user, teams, refresh, setUser: setUserState, logout }),
    [user, teams, refresh, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

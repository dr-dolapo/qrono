import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, api, setAuthToken, setUnauthorizedHandler } from "../lib/api";
import { clearSession, loadSession, saveSession } from "../lib/sessionStore";
import { unregisterPush } from "../notifications/push";
import { clearLiveCards } from "../live/liveCards";
import type { User } from "./types";

type Status = "loading" | "signedOut" | "signedIn";

interface AuthContextValue {
  status: Status;
  user: User | null;
  logIn(email: string, password: string): Promise<void>;
  logOut(): Promise<void>;
  /** Re-fetch the user, e.g. after they confirm their email. */
  refreshUser(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const tokenRef = useRef<string | null>(null);

  const signOutLocally = useCallback(async () => {
    tokenRef.current = null;
    setAuthToken(null);
    await clearSession();
    setUser(null);
    setStatus("signedOut");
  }, []);

  const refreshUser = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    const { user: fresh } = await api<{ user: User }>("/auth/me");
    setUser(fresh);
    await saveSession({ token, user: fresh });
  }, []);

  // When the API says the session has ended (e.g. password reset elsewhere), log out here too.
  useEffect(() => {
    setUnauthorizedHandler(() => void signOutLocally());
    return () => setUnauthorizedHandler(null);
  }, [signOutLocally]);

  // On launch: restore the saved session straight away, then check it with the server in the background.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadSession();
      if (cancelled) return;
      if (!saved) {
        setStatus("signedOut");
        return;
      }
      tokenRef.current = saved.token;
      setAuthToken(saved.token);
      setUser(saved.user);
      setStatus("signedIn");
      // Offline is fine: keep the saved user. A 401 signs out via the handler above.
      refreshUser().catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshUser]);

  const logIn = useCallback(async (email: string, password: string) => {
    const res = await api<{ user: User; session?: { token: string } }>("/auth/login", {
      body: { email: email.trim(), password },
    });
    if (!res.session) throw new ApiError(500, "Login didn't return a session. Please update the app.");
    tokenRef.current = res.session.token;
    setAuthToken(res.session.token);
    await saveSession({ token: res.session.token, user: res.user });
    setUser(res.user);
    setStatus("signedIn");
  }, []);

  const logOut = useCallback(async () => {
    // Stop broadcasts to this phone and end the session on the server too,
    // but never let a network problem keep someone logged in.
    await unregisterPush();
    await clearLiveCards().catch(() => undefined);
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    await signOutLocally();
  }, [signOutLocally]);

  const value = useMemo(() => ({ status, user, logIn, logOut, refreshUser }), [status, user, logIn, logOut, refreshUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

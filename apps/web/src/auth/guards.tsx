import type { ReactNode } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";
import { useAuth } from "./AuthContext";

/** Only allow same-site paths as a post-login destination (no open redirects). */
export function safeNext(value: string | null, fallback = "/admin"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

function Loading() {
  return (
    <main className="auth-shell" aria-busy="true">
      <p className="muted">Loading…</p>
    </main>
  );
}

/**
 * Protects a page. Sends people to log in, to confirm their email, or to
 * create their first team, in that order.
 */
export function RequireAuth({ children, needsTeam = true }: { children: ReactNode; needsTeam?: boolean }) {
  const { user, teams } = useAuth();
  const location = useLocation();

  if (user === undefined) return <Loading />;
  if (user === null) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (!user.emailVerified) return <Navigate to="/check-email" replace />;
  if (needsTeam && teams.length === 0) return <Navigate to="/onboarding/team" replace />;
  return <>{children}</>;
}

/** For login/sign-up pages: people who are already signed in go straight on. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [params] = useSearchParams();
  if (user === undefined) return <Loading />;
  if (user) return <Navigate to={user.emailVerified ? safeNext(params.get("next")) : "/check-email"} replace />;
  return <>{children}</>;
}

import { Link, Navigate } from "react-router";
import { useAuth } from "../auth/AuthContext";

export function Home() {
  const { user } = useAuth();
  if (user === undefined) return null;
  if (user) return <Navigate to={user.emailVerified ? "/admin" : "/check-email"} replace />;

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <p className="brand auth-brand">Qrono</p>
        <h1>Run live events on time, with no dead air.</h1>
        <p className="muted auth-subtitle">
          Plan the program with your team, get it approved, and keep everyone in sync on the day.
        </p>
        <div className="stack">
          <Link className="button button-primary" to="/signup">
            Create an account
          </Link>
          <Link className="button" to="/login">
            Log in
          </Link>
        </div>
      </div>
    </main>
  );
}

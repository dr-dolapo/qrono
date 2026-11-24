import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { useAuth } from "../../auth/AuthContext";
import { Alert, AuthLayout } from "../../components/Form";

/** Shown to people who joined with an invite link until an Admin or Planner lets them in. */
export function WaitingPage() {
  const { user, teams, currentTeam, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  if (user === undefined) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (currentTeam) return <Navigate to="/admin" replace />;

  const waitingFor = teams.filter((t) => t.status === "pending_vetting");
  if (waitingFor.length === 0) return <Navigate to="/onboarding/team" replace />;
  const names = waitingFor.map((t) => t.name).join(", ");

  return (
    <AuthLayout
      title="Waiting for approval"
      subtitle={
        <>
          Your request to join <strong>{names}</strong> has been sent. An Admin or Planner on the team will let you in, and
          then you'll see the team here.
        </>
      }
    >
      {checked && <Alert kind="info">Not approved yet. Check again in a little while.</Alert>}
      <div className="stack">
        <button
          type="button"
          className="button button-primary"
          onClick={async () => {
            await refresh();
            setChecked(true);
          }}
        >
          Check again
        </button>
        <Link className="button" to="/onboarding/team">
          Create my own team instead
        </Link>
      </div>
      <p className="auth-footer">
        <button
          type="button"
          className="link-button"
          onClick={async () => {
            await logout();
            navigate("/login", { replace: true });
          }}
        >
          Log out
        </button>
      </p>
    </AuthLayout>
  );
}

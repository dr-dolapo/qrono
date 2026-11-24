import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, ROLE_LABEL, api, type InviteInfo, type TeamSummary } from "../../api";
import { useAuth } from "../../auth/AuthContext";
import { Alert, AuthLayout } from "../../components/Form";
import { pendingInvite } from "../../storage";

/**
 * Where invitation links land (email invites and the shareable link).
 * Works whether or not the person has an account yet.
 */
export function InvitePage() {
  const { token = "" } = useParams();
  const { user, refresh, setCurrentTeam, logout } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ invite: InviteInfo }>(`/invites/${encodeURIComponent(token)}`)
      .then((res) => {
        setInvite(res.invite);
        // Remember it so they come back here after signing up and confirming their email.
        pendingInvite.set(token);
      })
      .catch((err) => {
        pendingInvite.clear();
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load this invitation.");
      });
  }, [token]);

  if (loadError) {
    return (
      <AuthLayout title="This invitation can't be used">
        <Alert>{loadError}</Alert>
        <Link className="button" to="/">
          Go to Qrono
        </Link>
      </AuthLayout>
    );
  }
  if (!invite || user === undefined) {
    return (
      <AuthLayout title="Opening invitation…">
        <p className="muted">One moment.</p>
      </AuthLayout>
    );
  }

  const roleText = `${invite.role === "approver" ? "an" : "a"} ${ROLE_LABEL[invite.role]}`;
  const subtitle = (
    <>
      <strong>{invite.invitedBy}</strong> invited you to join <strong>{invite.teamName}</strong> on Qrono as {roleText}.
      {invite.needsApproval && " Someone on the team will approve your request after you join."}
    </>
  );
  const next = encodeURIComponent(`/invite/${token}`);

  if (!user) {
    const signupQuery = `next=${next}${invite.email ? `&email=${encodeURIComponent(invite.email)}` : ""}`;
    return (
      <AuthLayout title={`Join ${invite.teamName}`} subtitle={subtitle}>
        <div className="stack">
          <Link className="button button-primary" to={`/signup?${signupQuery}`}>
            Create an account to join
          </Link>
          <Link className="button" to={`/login?next=${next}`}>
            I already have an account
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (!user.emailVerified) {
    return (
      <AuthLayout title={`Join ${invite.teamName}`} subtitle={subtitle}>
        <Alert kind="info">Confirm your email address first, then come back to this page.</Alert>
        <Link className="button button-primary" to="/check-email">
          Confirm my email
        </Link>
      </AuthLayout>
    );
  }

  async function join() {
    setBusy(true);
    setJoinError(null);
    try {
      const { team } = await api<{ team: TeamSummary }>(`/invites/${encodeURIComponent(token)}/accept`, { method: "POST", body: {} });
      pendingInvite.clear();
      await refresh();
      if (team.status === "active") {
        setCurrentTeam(team.id);
        navigate("/admin", { replace: true });
      } else {
        navigate("/waiting", { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setJoinError({ message: err.message, code: err.code });
        if (err.code !== "invite_wrong_account") pendingInvite.clear();
      } else {
        setJoinError({ message: "Something went wrong. Please try again." });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={`Join ${invite.teamName}`} subtitle={subtitle}>
      {joinError && <Alert>{joinError.message}</Alert>}
      <div className="stack">
        <button type="button" className="button button-primary" onClick={join} disabled={busy}>
          {busy ? "Joining…" : `Join ${invite.teamName}`}
        </button>
        {joinError?.code === "invite_wrong_account" && (
          <button
            type="button"
            className="button"
            onClick={async () => {
              await logout();
              navigate(`/login?next=${next}`, { replace: true });
            }}
          >
            Log in with a different account
          </button>
        )}
      </div>
      <p className="auth-footer small">
        Signed in as {user.email}
      </p>
    </AuthLayout>
  );
}

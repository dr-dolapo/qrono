import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { api } from "../../api";
import { useAuth } from "../../auth/AuthContext";
import { homePath } from "../../auth/guards";
import { Alert, AuthLayout } from "../../components/Form";

/** Shown after sign-up, and to anyone who logs in before confirming their email. */
export function CheckEmail() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [message, setMessage] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (user === undefined) return null;
  if (user === null) return <Navigate to="/login" replace />;
  if (user.emailVerified) return <Navigate to={homePath()} replace />;

  async function resend() {
    setBusy(true);
    try {
      await api("/auth/resend-verification", { method: "POST", body: {} });
      setMessage({ kind: "success", text: "We've sent you a new link." });
    } catch {
      setMessage({ kind: "error", text: "We couldn't send the email. Please try again in a minute." });
    } finally {
      setBusy(false);
    }
  }

  async function checkAgain() {
    await refresh();
    setMessage({ kind: "info", text: "We haven't seen a confirmation yet. Open the link in the email, then try again." });
  }

  return (
    <AuthLayout
      title="Check your email"
      subtitle={
        <>
          We sent a link to <strong>{user.email}</strong>. Open it to confirm your email address.
        </>
      }
    >
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      <div className="stack">
        <button type="button" className="button button-primary" onClick={checkAgain}>
          I've confirmed my email
        </button>
        <button type="button" className="button" onClick={resend} disabled={busy}>
          {busy ? "Sending…" : "Send a new link"}
        </button>
      </div>
      <p className="auth-footer">
        Wrong email?{" "}
        <button
          type="button"
          className="link-button"
          onClick={async () => {
            await logout();
            navigate("/signup", { replace: true });
          }}
        >
          Sign up again
        </button>
      </p>
    </AuthLayout>
  );
}

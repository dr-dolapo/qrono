import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ApiError, api } from "../../api";
import { useAuth } from "../../auth/AuthContext";
import { Alert, AuthLayout } from "../../components/Form";

type State = "working" | "done" | "failed";

/** QR003: the page the verification email links to. */
export function VerifyEmail() {
  const [params] = useSearchParams();
  const { user, refresh } = useAuth();
  const [state, setState] = useState<State>("working");
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    // Tokens are single-use; guard against React running effects twice in development.
    if (started.current) return;
    started.current = true;
    const token = params.get("token");
    if (!token) {
      setState("failed");
      setError("This link is missing its code. Open the link from the email again.");
      return;
    }
    api("/auth/verify-email", { body: { token } })
      .then(async () => {
        await refresh();
        setState("done");
      })
      .catch((err) => {
        setState("failed");
        setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      });
  }, [params, refresh]);

  if (state === "working") {
    return (
      <AuthLayout title="Confirming your email…">
        <p className="muted">One moment.</p>
      </AuthLayout>
    );
  }

  if (state === "done") {
    return (
      <AuthLayout title="Email confirmed" subtitle="Your Qrono account is ready.">
        <Link className="button button-primary" to={user ? "/admin" : "/login"}>
          {user ? "Continue" : "Log in"}
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="We couldn't confirm your email">
      <Alert>{error}</Alert>
      <Link className="button button-primary" to={user ? "/check-email" : "/login"}>
        {user ? "Get a new link" : "Log in to get a new link"}
      </Link>
    </AuthLayout>
  );
}

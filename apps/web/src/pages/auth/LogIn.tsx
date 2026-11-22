import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, type User } from "../../api";
import { useAuth } from "../../auth/AuthContext";
import { homePath, safeNext } from "../../auth/guards";
import { Alert, AuthLayout, SubmitButton, TextField } from "../../components/Form";
import { useForm } from "../../useForm";

/** QR004: log in. */
export function LogIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const form = useForm();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const justReset = params.get("reset") === "1";

  const submit = form.handle(async () => {
    const { user } = await api<{ user: User }>("/auth/login", { body: { email, password } });
    await refresh();
    navigate(user.emailVerified ? safeNext(params.get("next"), homePath()) : "/check-email", { replace: true });
  });

  return (
    <AuthLayout title="Log in">
      <form onSubmit={submit} noValidate>
        {justReset && <Alert kind="success">Your password has been changed. Log in with your new password.</Alert>}
        <Alert>{form.error}</Alert>
        <TextField label="Email" type="email" value={email} onChange={setEmail} error={form.fields.email} autoComplete="email" inputMode="email" required />
        <TextField label="Password" type="password" value={password} onChange={setPassword} error={form.fields.password} autoComplete="current-password" required />
        <p className="form-aside">
          <Link to="/forgot-password">Forgot your password?</Link>
        </p>
        <SubmitButton busy={form.busy}>Log in</SubmitButton>
      </form>
      <p className="auth-footer">
        New to Qrono? <Link to={`/signup${params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : ""}`}>Create an account</Link>
      </p>
    </AuthLayout>
  );
}

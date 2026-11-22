import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, type User } from "../../api";
import { useAuth } from "../../auth/AuthContext";
import { Alert, AuthLayout, SubmitButton, TextField } from "../../components/Form";
import { useForm } from "../../useForm";

/** QR002: create an account (web only). */
export function SignUp() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const form = useForm();
  const { refresh } = useAuth();
  const navigate = useNavigate();

  const submit = form.handle(async () => {
    await api<{ user: User }>("/auth/signup", { body: { firstName, lastName, email, password } });
    await refresh();
    navigate("/check-email", { replace: true });
  });

  return (
    <AuthLayout title="Create your account" subtitle="Plan and run live events without dead air.">
      <form onSubmit={submit} noValidate>
        <Alert>{form.error}</Alert>
        <div className="field-row">
          <TextField label="First name" value={firstName} onChange={setFirstName} error={form.fields.firstName} autoComplete="given-name" required />
          <TextField label="Last name" value={lastName} onChange={setLastName} error={form.fields.lastName} autoComplete="family-name" required />
        </div>
        <TextField label="Work email" type="email" value={email} onChange={setEmail} error={form.fields.email} autoComplete="email" inputMode="email" required />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          error={form.fields.password}
          hint="At least 10 characters."
          autoComplete="new-password"
          required
        />
        <SubmitButton busy={form.busy}>Create account</SubmitButton>
      </form>
      <p className="auth-footer">
        Already have an account? <Link to={`/login${params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : ""}`}>Log in</Link>
      </p>
    </AuthLayout>
  );
}

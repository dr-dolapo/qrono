import { useState } from "react";
import { Link } from "react-router";
import { api } from "../../api";
import { Alert, AuthLayout, SubmitButton, TextField } from "../../components/Form";
import { useForm } from "../../useForm";

/** QR005: ask for a password reset link. */
export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm();

  const submit = form.handle(async () => {
    await api("/auth/forgot-password", { body: { email } });
    setSentTo(email.trim());
  });

  if (sentTo) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle={
          <>
            If there's a Qrono account for <strong>{sentTo}</strong>, we've sent it a link to reset the password. The link
            expires in 1 hour.
          </>
        }
      >
        <Link className="button" to="/login">
          Back to log in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your email and we'll send you a link to choose a new password.">
      <form onSubmit={submit} noValidate>
        <Alert>{form.error}</Alert>
        <TextField label="Email" type="email" value={email} onChange={setEmail} error={form.fields.email} autoComplete="email" inputMode="email" required />
        <SubmitButton busy={form.busy}>Send reset link</SubmitButton>
      </form>
      <p className="auth-footer">
        <Link to="/login">Back to log in</Link>
      </p>
    </AuthLayout>
  );
}

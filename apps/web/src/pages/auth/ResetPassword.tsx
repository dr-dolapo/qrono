import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api } from "../../api";
import { useAuth } from "../../auth/AuthContext";
import { Alert, AuthLayout, SubmitButton, TextField } from "../../components/Form";
import { useForm } from "../../useForm";

/** QR005: choose a new password from the emailed link. */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const form = useForm();
  const { refresh } = useAuth();
  const navigate = useNavigate();

  const submit = form.handle(async () => {
    if (password !== confirm) {
      form.setFields({ confirm: "The passwords don't match." });
      return;
    }
    await api("/auth/reset-password", { body: { token, password } });
    // Every session was signed out, including this browser's.
    await refresh();
    navigate("/login?reset=1", { replace: true });
  });

  if (!token) {
    return (
      <AuthLayout title="This link isn't complete">
        <Alert>Open the link from the email again, or ask for a new one.</Alert>
        <Link className="button button-primary" to="/forgot-password">
          Get a new link
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="You'll be logged out on all your devices.">
      <form onSubmit={submit} noValidate>
        <Alert>
          {form.error}
          {form.error?.includes("expired") && (
            <>
              {" "}
              <Link to="/forgot-password">Get a new link</Link>
            </>
          )}
        </Alert>
        <TextField
          label="New password"
          type="password"
          value={password}
          onChange={setPassword}
          error={form.fields.password}
          hint="At least 10 characters."
          autoComplete="new-password"
          required
        />
        <TextField label="Confirm new password" type="password" value={confirm} onChange={setConfirm} error={form.fields.confirm} autoComplete="new-password" required />
        <SubmitButton busy={form.busy}>Change password</SubmitButton>
      </form>
    </AuthLayout>
  );
}

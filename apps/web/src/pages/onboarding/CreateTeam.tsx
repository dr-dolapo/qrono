import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../../api";
import { useAuth } from "../../auth/AuthContext";
import { Alert, AuthLayout, SubmitButton, TextField } from "../../components/Form";
import { useForm } from "../../useForm";

/** QR006: every new user creates (or later, joins) a team before planning events. */
export function CreateTeam() {
  const [name, setName] = useState("");
  const form = useForm();
  const { user, refresh } = useAuth();
  const navigate = useNavigate();

  const submit = form.handle(async () => {
    await api("/teams", { body: { name } });
    await refresh();
    navigate("/admin", { replace: true });
  });

  return (
    <AuthLayout
      title={`Welcome, ${user?.firstName ?? ""}`}
      subtitle="Create a team to start planning events. You can invite people once it's set up."
    >
      <form onSubmit={submit} noValidate>
        <Alert>{form.error}</Alert>
        <TextField
          label="Team name"
          value={name}
          onChange={setName}
          error={form.fields.name}
          hint="Usually your company, department or church, e.g. “Events Team”."
          autoComplete="organization"
          required
        />
        <SubmitButton busy={form.busy}>Create team</SubmitButton>
      </form>
    </AuthLayout>
  );
}

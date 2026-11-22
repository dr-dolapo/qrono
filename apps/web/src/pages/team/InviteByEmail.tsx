import { useState } from "react";
import { ROLE_LABEL, api, type Role } from "../../api";
import { Alert, TextField } from "../../components/Form";
import { useForm } from "../../useForm";

/** QR007: invite someone by email with a role. Only Approvers can invite Approvers. */
export function InviteByEmail({
  teamId,
  myRole,
  onInvited,
}: {
  teamId: string;
  myRole: Role;
  onInvited: (email: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const form = useForm();
  const roles: Role[] = myRole === "approver" ? ["member", "admin", "approver"] : ["member", "admin"];

  const submit = form.handle(async () => {
    await api(`/teams/${teamId}/invites`, { body: { email, role } });
    const sentTo = email.trim().toLowerCase();
    setEmail("");
    setRole("member");
    await onInvited(sentTo);
  });

  return (
    <section className="section" aria-labelledby="invite-heading">
      <h2 id="invite-heading">Invite by email</h2>
      <p className="muted small">They'll get an email with a link to join. The invitation lasts 7 days.</p>
      <form onSubmit={submit} noValidate className="inline-form">
        <Alert>{form.error}</Alert>
        <div className="inline-form-fields">
          <TextField
            label="Email address"
            type="email"
            value={email}
            onChange={setEmail}
            error={form.fields.email}
            autoComplete="off"
            inputMode="email"
            placeholder="name@company.com"
          />
          <div className="field">
            <label htmlFor="invite-role">Role</label>
            <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            {form.fields.role && <p className="field-error">{form.fields.role}</p>}
          </div>
          <div className="field field-submit">
            <button type="submit" className="button button-primary" disabled={form.busy}>
              {form.busy ? "Sending…" : "Send invite"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

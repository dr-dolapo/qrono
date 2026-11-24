import { useState } from "react";
import { ROLE_LABEL, api, type Role } from "../../api";
import { Alert } from "../../components/Form";
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
    <section className="settings-section" aria-labelledby="invite-heading">
      <div className="section-head">
        <h2 id="invite-heading">Invite by email</h2>
      </div>
      <p>They'll get an email with a link to join. Invitations last 7 days.</p>
      <form onSubmit={submit} noValidate className="invite-row">
        <label className="visually-hidden" htmlFor="invite-email">
          Email address
        </label>
        <input
          id="invite-email"
          className="input-filled"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="Enter email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={form.fields.email ? true : undefined}
          aria-describedby={form.fields.email ? "invite-email-error" : undefined}
        />
        <label className="visually-hidden" htmlFor="invite-role">
          Role
        </label>
        <select id="invite-role" className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <button type="submit" className="button button-primary button-auto" disabled={form.busy}>
          {form.busy ? "Sending…" : "Send invite"}
        </button>
      </form>
      {form.fields.email && (
        <p className="field-error" id="invite-email-error">
          {form.fields.email}
        </p>
      )}
      {form.fields.role && <p className="field-error">{form.fields.role}</p>}
      <Alert>{form.error}</Alert>
    </section>
  );
}

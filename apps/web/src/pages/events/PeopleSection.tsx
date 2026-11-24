import { useState } from "react";
import { ApiError, api, type EventDetail, type Participant, type Person } from "../../api";
import { Alert } from "../../components/Form";
import { Avatar } from "../../components/Avatar";
import { Icon } from "../../components/Icon";
import { Notice } from "../../components/Notice";
import type { Mutate } from "./EventEditor";
import { toast } from "sonner";

/**
 * Everyone on this program (added through Who on the agenda): whether they've joined
 * the team or are still to accept, emails still needed, and their replies once approved.
 */
export function PeopleSection({
  detail,
  mutate,
  people,
  reloadPeople,
  reloadEvent,
}: {
  detail: EventDetail;
  mutate: Mutate;
  people: Person[];
  reloadPeople: () => void;
  reloadEvent: () => void;
}) {
  const { participants, permissions, event, tasks } = detail;
  const [error, setError] = useState<string | null>(null);
  const taskCount = (pid: string) => tasks.filter((t) => t.assigneeIds.includes(pid)).length;
  const showResponses = event.status === "approved" || event.status === "live" || event.status === "past";
  const confirmed = participants.filter((p) => p.response === "acknowledged").length;
  const missingEmail = participants.filter((p) => !p.email);

  const statusOf = (p: Participant) => {
    if (p.userId) return { status: "member" as const, email: p.email };
    const listed = people.find((x) => x.kind === "contact" && x.contactId === p.contactId);
    return listed ? { status: listed.status, email: listed.email } : { status: "guest" as const, email: p.email };
  };

  if (participants.length === 0) return <p className="muted">Nobody yet. People are added when you choose them under Who on an agenda item.</p>;

  /** Right-hand status: replies once approved, otherwise team status. */
  const rightStatus = (p: Participant) => {
    if (showResponses) {
      if (p.response === "acknowledged") return { icon: "check" as const, tone: "good", label: "Confirmed" };
      if (p.response === "declined") return { icon: "warn" as const, tone: "bad", label: "Can't make it" };
      return { icon: "clock" as const, tone: "warn", label: "No reply yet" };
    }
    if (!p.email) return { icon: "warn" as const, tone: "bad", label: "Needs an email" };
    const st = statusOf(p).status;
    if (st === "member") return { icon: "check" as const, tone: "good", label: "Joined" };
    if (st === "invited") return { icon: "clock" as const, tone: "warn", label: "Invited" };
    return { icon: "clock" as const, tone: "muted", label: "Invited on approval" };
  };

  return (
    <section aria-label="People on this program">
      <p className="tab-intro">
        {showResponses
          ? `${confirmed} of ${participants.length} confirmed they'll be there.`
          : "Everyone chosen under Who. When the program is approved, they're emailed their part, and anyone new is invited to join the team."}
      </p>
      {missingEmail.length > 0 && permissions.canEdit && (
        <Notice kind="warn" title={`Add an email for ${missingEmail.map((p) => p.name).join(", ")}`}>
          The program can't go for review until everyone on it has an email.
        </Notice>
      )}
      <Alert>{error}</Alert>

      <ul className="list list-ruled">
        {participants.map((p) => {
          const st = rightStatus(p);
          const n = taskCount(p.id);
          return (
            <li key={p.id} className="list-row">
              <Avatar name={p.name} size={34} />
              <span className="list-main">
                <span className="list-name">{p.name}</span>
                <span className="list-sub">
                  {p.email ?? "No email yet"} · {n ? `${n} item${n === 1 ? "" : "s"}` : "not on any item"}
                </span>
                {showResponses && p.response === "declined" && p.declineReason && <span className="small decline-reason">“{p.declineReason}”</span>}
                {!p.email && p.contactId && permissions.canEdit && (
                  <AddEmail
                    name={p.name}
                    onSave={async (email) => {
                      await api(`/teams/${event.teamId}/people/${p.contactId}`, { method: "PATCH", body: { email } });
                      reloadPeople();
                      reloadEvent();
                      toast.success(`Email added for ${p.name}`);
                    }}
                  />
                )}
              </span>
              <span className="list-meta">
                <span className="list-status">
                  <Icon name={st.icon} className={`tone-${st.tone}-text`} /> {st.label}
                </span>
              </span>
              {permissions.canEdit && (
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() => mutate(`/participants/${p.id}`, "DELETE").catch(() => setError("Couldn't remove that person."))}
                >
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AddEmail({ name, onSave }: { name: string; onSave: (email: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="add-email"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSave(email.trim());
          setEmail("");
        } catch (err) {
          setError(err instanceof ApiError ? (err.fields.email ?? err.message) : "Couldn't save the email.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="visually-hidden" htmlFor={`email-${name}`}>
        Email for {name}
      </label>
      <input id={`email-${name}`} type="email" inputMode="email" placeholder={`${name}'s email`} value={email} onChange={(e) => setEmail(e.target.value)} />
      <button type="submit" className="button button-secondary button-small" disabled={busy || !email.trim()}>
        Add email
      </button>
      {error && <span className="field-error">{error}</span>}
    </form>
  );
}

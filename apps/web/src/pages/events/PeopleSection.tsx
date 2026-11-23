import { useState } from "react";
import { ApiError, api, type EventDetail, type Participant, type Person } from "../../api";
import { Alert } from "../../components/Form";
import { StatusTag } from "./agenda/WhoPicker";
import type { Mutate } from "./EventEditor";

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

  if (participants.length === 0) return null;

  return (
    <section className="section" aria-labelledby="people-heading">
      <h2 id="people-heading">
        People <span className="count">{participants.length}</span>
      </h2>
      {showResponses ? (
        <p className="muted small">
          {confirmed} of {participants.length} confirmed.
        </p>
      ) : (
        <p className="muted small">Everyone chosen under Who. When the program is approved, they're emailed their part, and anyone new is invited to join the team.</p>
      )}
      {missingEmail.length > 0 && permissions.canEdit && (
        <Alert kind="info">
          Add an email for {missingEmail.map((p) => p.name).join(", ")} before sending this program for review.
        </Alert>
      )}
      <Alert>{error}</Alert>

      <ul className="rows">
        {participants.map((p) => (
          <li key={p.id} className="row">
            <div className="row-main">
              <strong className="person-line">
                {p.name}
                {permissions.canEdit && <StatusTag person={statusOf(p)} />}
              </strong>
              <span className="muted small">
                {p.email ?? "No email yet"} · {taskCount(p.id) ? `${taskCount(p.id)} item${taskCount(p.id) === 1 ? "" : "s"}` : "not on any item"}
              </span>
              {showResponses && p.response === "declined" && p.declineReason && <span className="small decline-reason">“{p.declineReason}”</span>}
              {!p.email && p.contactId && permissions.canEdit && (
                <AddEmail
                  name={p.name}
                  onSave={async (email) => {
                    await api(`/teams/${event.teamId}/people/${p.contactId}`, { method: "PATCH", body: { email } });
                    reloadPeople();
                    reloadEvent();
                  }}
                />
              )}
            </div>
            {showResponses && (
              <div className="row-actions">
                <span className={`response response-${p.response}`}>
                  {p.response === "acknowledged" ? "Confirmed" : p.response === "declined" ? "Can't make it" : "No reply yet"}
                </span>
              </div>
            )}
            {permissions.canEdit && (
              <div className="row-actions">
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => mutate(`/participants/${p.id}`, "DELETE").catch(() => setError("Couldn't remove that person."))}
                >
                  Remove
                </button>
              </div>
            )}
          </li>
        ))}
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
      <button type="submit" className="button button-small" disabled={busy || !email.trim()}>
        Add email
      </button>
      {error && <span className="field-error">{error}</span>}
    </form>
  );
}

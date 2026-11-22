import { useEffect, useState } from "react";
import { api, type EventDetail, type Member } from "../../api";
import { Alert, TextField } from "../../components/Form";
import { useForm } from "../../useForm";
import type { Mutate } from "./EventEditor";

/** QR021: the people running this event — team members and guests (e.g. speakers without an account). */
export function PeopleSection({ detail, mutate }: { detail: EventDetail; mutate: Mutate }) {
  const { participants, permissions, event, tasks } = detail;
  const [teamMembers, setTeamMembers] = useState<Member[]>([]);
  const [memberId, setMemberId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const memberForm = useForm();
  const guestForm = useForm();

  useEffect(() => {
    if (!permissions.canEdit) return;
    api<{ members: Member[] }>(`/teams/${event.teamId}/members`)
      .then((r) => setTeamMembers(r.members.filter((m) => m.status === "active")))
      .catch(() => setTeamMembers([]));
  }, [event.teamId, permissions.canEdit]);

  const alreadyIn = new Set(participants.map((p) => p.userId).filter(Boolean));
  const available = teamMembers.filter((m) => !alreadyIn.has(m.user.id));
  const taskCount = (pid: string) => tasks.filter((t) => t.assigneeIds.includes(pid)).length;
  const showResponses = event.status === "approved" || event.status === "live" || event.status === "past";
  const confirmed = participants.filter((p) => p.response === "acknowledged").length;

  const addMember = memberForm.handle(async () => {
    if (!memberId) return;
    await mutate("/participants", "POST", { userId: memberId });
    setMemberId("");
  });

  const addGuest = guestForm.handle(async () => {
    await mutate("/participants", "POST", { guestName, guestEmail });
    setGuestName("");
    setGuestEmail("");
  });

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
        <p className="muted small">Add the people running this event, then assign them to tasks. They're notified once the event is approved.</p>
      )}
      <Alert>{error}</Alert>

      {participants.length > 0 && (
        <ul className="rows">
          {participants.map((p) => (
            <li key={p.id} className="row">
              <div className="row-main">
                <strong>
                  {p.name} {p.kind === "guest" && <span className="badge badge-muted">Guest</span>}
                </strong>
                <span className="muted small">
                  {p.email} · {taskCount(p.id) ? `${taskCount(p.id)} task${taskCount(p.id) === 1 ? "" : "s"}` : "no tasks yet"}
                </span>
                {showResponses && p.response === "declined" && p.declineReason && <span className="small decline-reason">“{p.declineReason}”</span>}
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
      )}

      {permissions.canEdit && (
        <div className="two-col">
          <form onSubmit={addMember} noValidate className="card-panel">
            <h3>Add from your team</h3>
            <Alert>{memberForm.error}</Alert>
            {available.length === 0 ? (
              <p className="muted small">Everyone on the team is already in this event.</p>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="add-member">Team member</label>
                  <select id="add-member" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                    <option value="">Choose someone…</option>
                    {available.map((m) => (
                      <option key={m.user.id} value={m.user.id}>
                        {m.user.firstName} {m.user.lastName}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="button button-small" disabled={!memberId || memberForm.busy}>
                  Add to event
                </button>
              </>
            )}
          </form>

          <form onSubmit={addGuest} noValidate className="card-panel">
            <h3>Add a guest</h3>
            <p className="muted small">For people without a Qrono account, like guest speakers. They won't need the app.</p>
            <Alert>{guestForm.error}</Alert>
            <TextField label="Guest name" value={guestName} onChange={setGuestName} error={guestForm.fields.guestName} />
            <TextField label="Guest email" type="email" inputMode="email" value={guestEmail} onChange={setGuestEmail} error={guestForm.fields.guestEmail} />
            <button type="submit" className="button button-small" disabled={guestForm.busy}>
              Add guest
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

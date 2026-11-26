import { useState } from "react";
import { ApiError, type EventDetail } from "../../api";
import { Alert } from "../../components/Form";
import { formatTime } from "../../time";
import type { Mutate } from "./EventEditor";

/**
 * QR033–QR035: a participant's tasks. They're attending by default; they can say they can't make
 * it (with a reason), and change their mind.
 */
export function MyPart({ detail, mutate }: { detail: EventDetail; mutate: Mutate }) {
  const mine = detail.me.participant;
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!mine) return null;

  const myTasks = detail.tasks.filter((t) => t.assigneeIds.includes(mine.id));

  async function respond(response: "acknowledged" | "declined") {
    setBusy(true);
    setError(null);
    try {
      await mutate("/response", "POST", response === "declined" ? { response, reason } : { response });
      setDeclining(false);
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.reason ?? err.message) : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card-panel my-part" aria-labelledby="my-part-heading">
      <h2 id="my-part-heading">Your part</h2>
      {myTasks.length > 0 ? (
        <ul className="plain-list">
          {myTasks.map((t) => (
            <li key={t.id}>
              <strong>{formatTime(t.startAt, detail.event.timezone)}</strong> {t.title}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">You're in this event but not on a task yet.</p>
      )}

      {detail.permissions.canRespond && (
        <>
          {mine.response === "declined" ? (
            <Alert kind="info">You've told the team you can't take part: “{mine.declineReason}”.</Alert>
          ) : (
            <p className="muted small">You're down as attending.</p>
          )}
          <Alert>{error}</Alert>
          {declining ? (
            <div className="field">
              <label htmlFor="decline-reason">Why can't you take part?</label>
              <textarea id="decline-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
              <div className="button-row">
                <button type="button" className="button button-small button-danger" disabled={busy} onClick={() => respond("declined")}>
                  Send to the team
                </button>
                <button type="button" className="button button-small" onClick={() => setDeclining(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : mine.response === "declined" ? (
            <div className="button-row">
              <button type="button" className="button button-small button-primary" disabled={busy} onClick={() => respond("acknowledged")}>
                I can make it after all
              </button>
            </div>
          ) : (
            <div className="button-row">
              <button type="button" className="button button-small" disabled={busy} onClick={() => setDeclining(true)}>
                I can't make it
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

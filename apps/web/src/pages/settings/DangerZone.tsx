import { useState } from "react";
import { toast } from "sonner";
import { ApiError, api, type Member } from "../../api";

/** Approvers only: hand the team to someone else, or delete it. Both need a clear second step. */
export function DangerZone({ teamId, teamName, members, onGone }: { teamId: string; teamName: string; members: Member[]; onGone: () => Promise<void> }) {
  const [heir, setHeir] = useState("");
  const [confirmHandover, setConfirmHandover] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const heirName = members.find((m) => m.id === heir);

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      toast.success(message);
      await onGone();
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fields)[0] ?? err.message) : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="danger">
      <div className="danger-item">
        <div>
          <h3 className="sub-head">Hand the team over</h3>
          <p>They become an Approver, and you leave the team.</p>
        </div>
        <div className="setting-row">
          <label className="visually-hidden" htmlFor="heir">
            Hand the team to
          </label>
          <select
            id="heir"
            className="select setting-select"
            value={heir}
            onChange={(e) => {
              setHeir(e.target.value);
              setConfirmHandover(false);
            }}
          >
            <option value="">Choose someone…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.user.firstName} {m.user.lastName}
              </option>
            ))}
          </select>
          {confirmHandover && heirName ? (
            <button
              type="button"
              className="button button-danger button-auto"
              disabled={busy}
              onClick={() => run(() => api(`/teams/${teamId}/handover`, { body: { membershipId: heir } }), `${heirName.user.firstName} now looks after ${teamName}`)}
            >
              Yes, hand over and leave
            </button>
          ) : (
            <button type="button" className="button button-secondary button-auto" disabled={!heir} onClick={() => setConfirmHandover(true)}>
              Hand over
            </button>
          )}
        </div>
      </div>

      <div className="danger-item">
        <div>
          <h3 className="sub-head">Delete this team</h3>
          <p>Deletes every event, program and invitation. This can't be undone.</p>
        </div>
        <div className="setting-field">
          <label htmlFor="confirm-name" className="field-label field-label-inline">
            Type <strong>{teamName}</strong> to confirm
          </label>
          <div className="setting-row">
            <input id="confirm-name" className="input-filled" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            <button
              type="button"
              className="button button-danger button-auto"
              disabled={busy || typed.trim() !== teamName}
              onClick={() => run(() => api(`/teams/${teamId}`, { method: "DELETE", body: { confirmName: typed } }), `${teamName} has been deleted`)}
            >
              Delete team
            </button>
          </div>
        </div>
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

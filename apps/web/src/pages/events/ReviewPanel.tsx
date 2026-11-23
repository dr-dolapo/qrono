import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ApiError, api, type EventDetail, type Member } from "../../api";
import { Alert } from "../../components/Form";
import type { Mutate } from "./EventEditor";

/**
 * The event's place in the lifecycle (PRD §7) and the next step:
 * Draft → send for review (QR011) → Review → approve (QR016) → Approved.
 */
export function ReviewPanel({ detail, mutate }: { detail: EventDetail; mutate: Mutate }) {
  const { event, permissions, approvers, tasks, me } = detail;
  const [choosing, setChoosing] = useState(false);
  const [teamApprovers, setTeamApprovers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!choosing) return;
    api<{ members: Member[] }>(`/teams/${event.teamId}/members`)
      .then((r) => {
        const list = r.members.filter((m) => m.status === "active" && m.role === "approver");
        setTeamApprovers(list);
        // Pre-select when there's only one choice.
        if (list.length === 1) setSelected([list[0]!.user.id]);
      })
      .catch(() => setError("Couldn't load the team's Approvers."));
  }, [choosing, event.teamId]);

  async function run(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await mutate(path, "POST", body);
      setChoosing(false);
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fields)[0] ?? err.message) : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const names = (list: { name: string }[]) => list.map((a) => a.name).join(", ");

  if (event.status === "draft") {
    if (!permissions.canManage) return null;
    return (
      <section className="review-panel review-draft" aria-label="Review">
        <div className="review-text">
          <strong>Draft</strong>
          <span className="muted small">
            {tasks.length === 0 ? "Add items to the agenda, then send it for approval." : "When the plan is ready, send it to an Approver."}
          </span>
        </div>
        {!choosing && (
          <button type="button" className="button button-primary button-auto" disabled={!permissions.canSubmit} onClick={() => setChoosing(true)}>
            Send for review
          </button>
        )}
        {choosing && (
          <div className="review-choose">
            <Alert>{error}</Alert>
            <fieldset className="assignee-picker">
              <legend>Who should approve it?</legend>
              <div className="chips">
                {teamApprovers.map((m) => {
                  const on = selected.includes(m.user.id);
                  return (
                    <label key={m.id} className={`chip ${on ? "chip-on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setSelected((s) => (on ? s.filter((x) => x !== m.user.id) : [...s, m.user.id]))}
                      />
                      {m.user.firstName} {m.user.lastName}
                      {m.user.id === me.userId && <span className="muted"> (you)</span>}
                    </label>
                  );
                })}
              </div>
              <p className="muted small">Any one of them can approve. While it's in review, the plan is locked.</p>
            </fieldset>
            <div className="button-row">
              <button type="button" className="button button-primary button-auto" disabled={busy || selected.length === 0} onClick={() => run("/submit", { approverIds: selected })}>
                {busy ? "Sending…" : "Send for review"}
              </button>
              <button type="button" className="button button-auto" onClick={() => setChoosing(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    );
  }

  if (event.status === "review") {
    return (
      <section className="review-panel review-review" aria-label="Review">
        <div className="review-text">
          <strong>Waiting for approval</strong>
          <span className="muted small">
            Sent to {names(approvers)}. Comment on any item below. The plan is locked while it's in review.
          </span>
          <Alert>{error}</Alert>
        </div>
        <div className="button-row">
          {permissions.canApprove && (
            <button type="button" className="button button-primary button-auto" disabled={busy} onClick={() => run("/approve")}>
              {busy ? "Approving…" : "Approve event"}
            </button>
          )}
          {permissions.canWithdraw && (
            <button type="button" className="button button-auto" disabled={busy} onClick={() => run("/withdraw")}>
              Move back to draft
            </button>
          )}
        </div>
      </section>
    );
  }

  const approvedBy = approvers.filter((a) => a.approvedAt);
  const commandLink = permissions.canRunLive && (
    <Link className="button button-primary button-auto" to={`/command/${event.id}`}>
      Open command centre
    </Link>
  );

  if (event.status === "live") {
    return (
      <section className="review-panel review-live" aria-label="Status">
        <div className="review-text">
          <strong>Live</strong>
          <span className="muted small">
            The event is running.{" "}
            {permissions.canEdit && "You can still change what hasn't happened yet; the people affected are emailed 2 minutes after your last change."}
          </span>
        </div>
        {commandLink}
      </section>
    );
  }

  if (event.status === "past") {
    return (
      <section className="review-panel" aria-label="Status">
        <div className="review-text">
          <strong>Ended</strong>
          <span className="muted small">This event is over.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="review-panel review-approved" aria-label="Review">
      <div className="review-text">
        <strong>Approved</strong>
        <span className="muted small">
          {approvedBy.length > 0 &&
            `Approved by ${names(approvedBy)} on ${new Date(approvedBy[0]!.approvedAt!).toLocaleDateString([], { day: "numeric", month: "short" })}. `}
          Everyone on the program has been emailed their part.
          {permissions.canEdit && " If you change the plan, the people affected are emailed 2 minutes after your last change."}
        </span>
      </div>
      {commandLink}
    </section>
  );
}

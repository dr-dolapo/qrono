import clsx from "clsx";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { ApiError, STATUS_LABEL, api, type EventDetail, type Member, type SettingsResponse } from "../../api";
import { refreshComingUp } from "../../components/AppShell";
import { Alert } from "../../components/Form";
import { HelpTip } from "../../components/HelpTip";
import { Icon } from "../../components/Icon";
import type { Mutate } from "./EventEditor";

const STEPS = [
  { status: "draft", label: "Draft" },
  { status: "review", label: "In review" },
  { status: "approved", label: "Approved, everyone emailed" },
  { status: "live", label: "Live" },
] as const;
/** When the team doesn't require approval there's no review step. */
const STEPS_NO_REVIEW = [
  { status: "draft", label: "Draft" },
  { status: "approved", label: "Published, everyone emailed" },
  { status: "live", label: "Live" },
] as const;

const names = (list: { name: string }[]) => list.map((a) => a.name).join(", ");

/**
 * The right rail of an event: where the program is in its lifecycle (PRD §7),
 * the one next step, and the event's settings in collapsible rows.
 */
export function StatusRail({ detail, mutate, onEditDetails }: { detail: EventDetail; mutate: Mutate; onEditDetails: () => void }) {
  const { event, permissions, approvers, tasks, participants, me, team } = detail;
  const navigate = useNavigate();
  const [choosing, setChoosing] = useState(false);
  const [teamApprovers, setTeamApprovers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!choosing) return;
    Promise.all([api<{ members: Member[] }>(`/teams/${event.teamId}/members`), api<SettingsResponse>(`/teams/${event.teamId}/settings`)])
      .then(([r, settings]) => {
        // Teams can stop people approving what they sent; then they aren't offered.
        const list = r.members.filter((m) => m.status === "active" && m.role === "approver" && (team.allowSelfApproval || m.user.id !== me.userId));
        setTeamApprovers(list);
        const defaults = (settings.settings?.defaultApproverIds ?? []).filter((id) => list.some((m) => m.user.id === id));
        setSelected(defaults.length ? defaults : list.length === 1 ? [list[0]!.user.id] : []);
      })
      .catch(() => setError("Couldn't load the team's Admins."));
  }, [choosing, event.teamId, team.allowSelfApproval, me.userId]);

  async function run(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await mutate(path, "POST", body);
      setChoosing(false);
      refreshComingUp();
      const done: Record<string, string> = {
        "/submit": "Sent for review",
        "/approve": "Approved. Everyone is being emailed their part.",
        "/withdraw": "Taken back to draft",
        "/publish": "Published. Everyone is being emailed their part.",
      };
      if (done[path]) toast.success(done[path]);
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fields)[0] ?? err.message) : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const missingEmail = participants.filter((p) => !p.email);
  const approvedBy = approvers.filter((a) => a.approvedAt);
  const steps = team.requireApproval || event.status === "review" ? STEPS : STEPS_NO_REVIEW;
  const stepIndex = steps.findIndex((s) => s.status === event.status);

  const explanation: Record<string, string> = {
    draft: team.requireApproval
      ? "Only Planners and Admins can see it. Send it to an Admin when it's ready."
      : "Only Planners and Admins can see it. Publish it when it's ready; your team doesn't need approval.",
    review: `Waiting for ${names(approvers) || "an Admin"}. The plan is locked while it's in review; comment on any item.`,
    approved: `${approvedBy.length ? `Approved by ${names(approvedBy)}. ` : ""}Everyone on the program has been emailed their part.`,
    live: "The event is running. Changes to what hasn't happened yet are emailed 2 minutes after your last edit.",
    past: "This event is over.",
  };

  let primary: React.ReactNode = null;
  let helper: string | null = null;
  if (event.status === "draft" && permissions.canManage) {
    helper =
      tasks.length === 0
        ? "Add at least one item to the agenda first."
        : missingEmail.length > 0
          ? `${missingEmail.length === 1 ? "1 person needs" : `${missingEmail.length} people need`} an email first.`
          : null;
    primary = team.requireApproval ? (
      !choosing && (
        <button type="button" className="button button-primary button-pill" disabled={!permissions.canSubmit} onClick={() => setChoosing(true)}>
          Send for review
        </button>
      )
    ) : (
      <button type="button" className="button button-primary button-pill" disabled={!permissions.canPublish || busy} onClick={() => run("/publish")}>
        {busy ? "Publishing…" : "Publish program"}
      </button>
    );
  } else if (event.status === "review") {
    primary = (
      <>
        {permissions.canApprove && (
          <button type="button" className="button button-primary button-pill" disabled={busy} onClick={() => run("/approve")}>
            {busy ? "Approving…" : "Approve program"}
          </button>
        )}
        {!team.allowSelfApproval && team.submittedBy === me.userId && approvers.some((a) => a.userId === me.userId) && (
          <p className="rail-helper">You sent this for review, so another Admin needs to approve it.</p>
        )}
        {permissions.canWithdraw && (
          <button type="button" className="button button-secondary button-pill" disabled={busy} onClick={() => run("/withdraw")}>
            Move back to draft
          </button>
        )}
      </>
    );
  } else if ((event.status === "approved" || event.status === "live") && permissions.canRunLive) {
    primary = (
      <Link className="button button-primary button-pill" to={`/command/${event.id}`}>
        <Icon name="play" size={14} /> Open command centre
      </Link>
    );
  }

  return (
    <>
      <section aria-labelledby="status-heading">
        <div className="rail-label">
          <h2 id="status-heading">Program status</h2>
          <HelpTip label="Program status">
            Draft → In review → Approved → Live. Nobody is emailed until an Admin approves the program; then everyone gets their part, and anyone new
            is invited to the team.
          </HelpTip>
        </div>
        <p className="rail-big">{STATUS_LABEL[event.status]}</p>
        <p className="rail-text">{explanation[event.status]}</p>
        {event.status !== "past" && (
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={s.status} className={clsx(i === stepIndex && "on", i < stepIndex && "done")} aria-current={i === stepIndex ? "step" : undefined}>
                <span className="step-dot">{i < stepIndex ? <Icon name="check" size={11} /> : i + 1}</span>
                {s.label}
              </li>
            ))}
          </ol>
        )}
        <Alert>{error}</Alert>

        {choosing && (
          <fieldset className="approver-choice">
            <legend>Who should approve it?</legend>
            {teamApprovers.map((m) => {
              const on = selected.includes(m.user.id);
              return (
                <label key={m.id} className="check-row">
                  <input type="checkbox" checked={on} onChange={() => setSelected((s) => (on ? s.filter((x) => x !== m.user.id) : [...s, m.user.id]))} />
                  {m.user.firstName} {m.user.lastName}
                  {m.user.id === me.userId && <span className="muted"> (you)</span>}
                </label>
              );
            })}
            <p className="small muted">Any one of them can approve.</p>
            <div className="rail-actions">
              <button type="button" className="button button-primary button-pill" disabled={busy || selected.length === 0} onClick={() => run("/submit", { approverIds: selected })}>
                {busy ? "Sending…" : "Send for review"}
              </button>
              <button type="button" className="button button-soft" onClick={() => setChoosing(false)}>
                Cancel
              </button>
            </div>
          </fieldset>
        )}
        {primary && <div className="rail-actions">{primary}</div>}
        {helper && <p className="rail-helper">{helper}</p>}
      </section>

      <div className="accordion">
        <details>
          <summary>
            <span>
              Moving to the next item<small>{event.progressionMode === "auto" ? "Automatically, on time" : "Manually, by a Planner"}</small>
            </span>
            <Icon name="plus" className="accordion-icon" />
          </summary>
          <div className="accordion-body">
            {permissions.canEdit ? (
              <label className="field-label">
                How the live program moves on
                <select
                  className="select"
                  value={event.progressionMode}
                  onChange={(e) => mutate("", "PATCH", { progressionMode: e.target.value }).catch(() => setError("Couldn't save that setting."))}
                >
                  <option value="manual">Manually, by a Planner</option>
                  <option value="auto">Automatically, on time</option>
                </select>
              </label>
            ) : (
              <p className="rail-text">{event.progressionMode === "auto" ? "Each item ends on time and the next starts by itself." : "A Planner moves to the next item."}</p>
            )}
          </div>
        </details>

        <details>
          <summary>
            <span>
              Admins<small>{approvers.length ? names(approvers) : "Chosen when it's sent for review"}</small>
            </span>
            <Icon name="plus" className="accordion-icon" />
          </summary>
          <div className="accordion-body">
            {approvers.length ? (
              <ul className="plain-list">
                {approvers.map((a) => (
                  <li key={a.userId}>
                    {a.name}{" "}
                    <span className="muted small">{a.approvedAt ? `approved ${new Date(a.approvedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "hasn't approved yet"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rail-text">You'll choose them when you send the program for review.</p>
            )}
          </div>
        </details>

        <details>
          <summary>
            <span>
              Event details<small>Name, times, time zone</small>
            </span>
            <Icon name="plus" className="accordion-icon" />
          </summary>
          <div className="accordion-body">
            <p className="rail-text">{event.description || "No description."}</p>
            {permissions.canEdit && (
              <button type="button" className="button button-secondary button-small" onClick={onEditDetails}>
                <Icon name="pencil" size={14} /> Edit details
              </button>
            )}
          </div>
        </details>

        {event.status === "draft" && permissions.canEdit && (
          <details>
            <summary>
              <span>
                Danger zone<small>Delete this draft</small>
              </span>
              <Icon name="plus" className="accordion-icon" />
            </summary>
            <div className="accordion-body">
              <p className="rail-text">Deleting removes the event and its agenda. Nobody has been emailed about it yet.</p>
              {confirmDelete ? (
                <div className="rail-actions rail-actions-row">
                  <button
                    type="button"
                    className="button button-danger button-small"
                    onClick={async () => {
                      try {
                        await api(`/events/${event.id}`, { method: "DELETE" });
                        refreshComingUp();
                        toast.success("Draft deleted");
                        navigate("/admin", { replace: true });
                      } catch (err) {
                        setError(err instanceof ApiError ? err.message : "Couldn't delete the event.");
                      }
                    }}
                  >
                    Yes, delete draft
                  </button>
                  <button type="button" className="button button-soft button-small" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button type="button" className="button button-secondary button-small" onClick={() => setConfirmDelete(true)}>
                  Delete draft
                </button>
              )}
            </div>
          </details>
        )}
      </div>
    </>
  );
}

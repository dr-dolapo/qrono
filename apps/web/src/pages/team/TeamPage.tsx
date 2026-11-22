import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ApiError, ROLE_LABEL, api, type Member, type PendingInvite, type Role } from "../../api";
import { useAuth } from "../../auth/AuthContext";
import { AppShell } from "../../components/AppShell";
import { Alert } from "../../components/Form";
import { InviteByEmail } from "./InviteByEmail";
import { InviteLink } from "./InviteLink";

interface MembersResponse {
  me: { membershipId: string; role: Role };
  members: Member[];
}

const ROLE_HELP: Record<Role, string> = {
  approver: "Everything an Admin can do, plus approving events.",
  admin: "Creates and edits events, and manages people.",
  member: "Can be assigned tasks in events.",
};

/** QR001, QR007, QR009: the team's people, join requests and invitations. */
export function TeamPage() {
  const { currentTeam, refresh: refreshAuth } = useAuth();
  const navigate = useNavigate();
  const teamId = currentTeam!.id;
  const [data, setData] = useState<MembersResponse | null>(null);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);

  const canManage = data?.me.role === "approver" || data?.me.role === "admin";

  const load = useCallback(async () => {
    try {
      const members = await api<MembersResponse>(`/teams/${teamId}/members`);
      setData(members);
      if (members.me.role !== "member") {
        setInvites((await api<{ invites: PendingInvite[] }>(`/teams/${teamId}/invites`)).invites);
      } else {
        setInvites([]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load the team.");
    }
  }, [teamId]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  async function act(id: string, action: () => Promise<unknown>, success: string) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
      setNotice(success);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusyId(null);
      // Only close the confirmation this action belonged to, not one opened meanwhile.
      setConfirmingRemove((current) => (current === id ? null : current));
    }
  }

  if (!data) {
    return (
      <AppShell>
        <h1>Team</h1>
        {error ? <Alert>{error}</Alert> : <p className="muted">Loading…</p>}
      </AppShell>
    );
  }

  const me = data.me;
  const pending = data.members.filter((m) => m.status === "pending_vetting");
  const active = data.members.filter((m) => m.status === "active");

  /** Mirrors the API's rules so people only see choices that will work. */
  const roleOptions = (target: Member): Role[] => {
    if (!canManage) return [];
    if (target.role === "approver" && me.role !== "approver") return [];
    return me.role === "approver" ? ["approver", "admin", "member"] : ["admin", "member"];
  };
  const canRemove = (target: Member) =>
    target.id === me.membershipId || (canManage && !(target.role === "approver" && me.role !== "approver"));

  return (
    <AppShell>
      <h1>{currentTeam!.name}</h1>
      <Alert>{error}</Alert>
      {notice && <Alert kind="success">{notice}</Alert>}

      {canManage && pending.length > 0 && (
        <section className="section" aria-labelledby="requests-heading">
          <h2 id="requests-heading">
            Waiting for approval <span className="count">{pending.length}</span>
          </h2>
          <p className="muted small">These people used your invite link. Check who they are before letting them in.</p>
          <ul className="rows">
            {pending.map((m) => (
              <li key={m.id} className="row">
                <div className="row-main">
                  <strong>
                    {m.user.firstName} {m.user.lastName}
                  </strong>
                  <span className="muted small">{m.user.email}</span>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="button button-small button-primary"
                    disabled={busyId === m.id}
                    onClick={() => act(m.id, () => api(`/teams/${teamId}/members/${m.id}/approve`, { method: "POST", body: {} }), `${m.user.firstName} has joined the team.`)}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="button button-small"
                    disabled={busyId === m.id}
                    onClick={() => act(m.id, () => api(`/teams/${teamId}/members/${m.id}`, { method: "DELETE" }), `Declined ${m.user.firstName}'s request.`)}
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section" aria-labelledby="members-heading">
        <h2 id="members-heading">
          People <span className="count">{active.length}</span>
        </h2>
        <ul className="rows">
          {active.map((m) => {
            const isMe = m.id === me.membershipId;
            const options = roleOptions(m);
            return (
              <li key={m.id} className="row">
                <div className="row-main">
                  <strong>
                    {m.user.firstName} {m.user.lastName}
                    {isMe && <span className="muted"> (you)</span>}
                  </strong>
                  <span className="muted small">{m.user.email}</span>
                </div>
                <div className="row-actions">
                  {options.length > 0 ? (
                    <label>
                      <span className="visually-hidden">Role for {m.user.firstName}</span>
                      <select
                        value={m.role}
                        disabled={busyId === m.id}
                        title={ROLE_HELP[m.role]}
                        onChange={(e) => {
                          const role = e.target.value as Role;
                          void act(m.id, () => api(`/teams/${teamId}/members/${m.id}`, { method: "PATCH", body: { role } }), `${m.user.firstName} is now ${role === "admin" ? "an" : "a"} ${ROLE_LABEL[role]}.`);
                        }}
                      >
                        {options.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span className="badge" title={ROLE_HELP[m.role]}>
                      {ROLE_LABEL[m.role]}
                    </span>
                  )}
                  {canRemove(m) &&
                    (confirmingRemove === m.id ? (
                      <>
                        <button
                          type="button"
                          className="button button-small button-danger"
                          disabled={busyId === m.id}
                          onClick={() =>
                            act(
                              m.id,
                              async () => {
                                await api(`/teams/${teamId}/members/${m.id}`, { method: "DELETE" });
                                if (isMe) {
                                  await refreshAuth();
                                  navigate("/admin", { replace: true });
                                }
                              },
                              `${m.user.firstName} has been removed from the team.`,
                            )
                          }
                        >
                          {isMe ? "Yes, leave" : "Yes, remove"}
                        </button>
                        <button type="button" className="button button-small" onClick={() => setConfirmingRemove(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button type="button" className="button button-small" onClick={() => setConfirmingRemove(m.id)}>
                        {isMe ? "Leave team" : "Remove"}
                      </button>
                    ))}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="muted small role-legend">
          <strong>Approver:</strong> {ROLE_HELP.approver} <strong>Admin:</strong> {ROLE_HELP.admin} <strong>Member:</strong> {ROLE_HELP.member}
        </p>
      </section>

      {canManage && (
        <>
          <InviteByEmail
            teamId={teamId}
            myRole={me.role}
            onInvited={async (email) => {
              setNotice(`Invitation sent to ${email}.`);
              await load();
            }}
          />

          {invites.filter((i) => i.channel === "email").length > 0 && (
            <section className="section" aria-labelledby="invites-heading">
              <h2 id="invites-heading">Invitations sent</h2>
              <ul className="rows">
                {invites
                  .filter((i) => i.channel === "email")
                  .map((i) => (
                    <li key={i.id} className="row">
                      <div className="row-main">
                        <strong>{i.email}</strong>
                        <span className="muted small">
                          {ROLE_LABEL[i.role]} · invited by {i.invitedBy} · expires {new Date(i.expiresAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button button-small"
                          disabled={busyId === i.id}
                          onClick={() => act(i.id, () => api(`/teams/${teamId}/invites/${i.id}`, { method: "DELETE" }), `Cancelled the invitation to ${i.email}.`)}
                        >
                          Cancel invitation
                        </button>
                      </div>
                    </li>
                  ))}
              </ul>
            </section>
          )}

          <InviteLink
            teamId={teamId}
            activeLink={invites.find((i) => i.channel === "link") ?? null}
            onTurnOff={(id) => act(id, () => api(`/teams/${teamId}/invites/${id}`, { method: "DELETE" }), "The invite link has been turned off.")}
            onChanged={load}
          />
        </>
      )}
    </AppShell>
  );
}

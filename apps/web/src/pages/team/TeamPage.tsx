import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ApiError, ROLE_LABEL, api, type Member, type PendingInvite, type Person, type Role, type TeamSettings } from "../../api";
import { useAuth } from "../../auth/AuthContext";
import { AppShell } from "../../components/AppShell";
import { Avatar } from "../../components/Avatar";
import { Alert } from "../../components/Form";
import { HelpTip } from "../../components/HelpTip";
import { Icon } from "../../components/Icon";
import { relativeDay } from "../../time";
import { InviteByEmail } from "./InviteByEmail";
import { InviteLink } from "./InviteLink";

interface MembersResponse {
  me: { membershipId: string; role: Role };
  members: Member[];
}

const ROLE_HELP: Record<Role, string> = {
  approver: "Everything an Admin can do, plus approving programs.",
  admin: "Creates and edits events, and manages people.",
  member: "Can be given parts in events.",
};

const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** QR001, QR007, QR009: People — everyone on the team, join requests and invitations. */
export function TeamPage() {
  const { currentTeam, refresh: refreshAuth } = useAuth();
  const navigate = useNavigate();
  const teamId = currentTeam!.id;
  const [data, setData] = useState<MembersResponse | null>(null);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [contacts, setContacts] = useState<Extract<Person, { kind: "contact" }>[]>([]);
  const [settings, setSettings] = useState<TeamSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);

  const canManage = data?.me.role === "approver" || data?.me.role === "admin";

  const load = useCallback(async () => {
    try {
      const members = await api<MembersResponse>(`/teams/${teamId}/members`);
      setData(members);
      if (members.me.role !== "member") {
        const [inv, ppl, st] = await Promise.all([
          api<{ invites: PendingInvite[] }>(`/teams/${teamId}/invites`),
          api<{ people: Person[] }>(`/teams/${teamId}/people`),
          api<{ settings: TeamSettings | null }>(`/teams/${teamId}/settings`),
        ]);
        setSettings(st.settings);
        setInvites(inv.invites);
        setContacts(ppl.people.filter((p): p is Extract<Person, { kind: "contact" }> => p.kind === "contact"));
      } else {
        setInvites([]);
        setContacts([]);
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
    try {
      await action();
      await load();
      toast.success(success);
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
        <h1>People</h1>
        {error ? <Alert>{error}</Alert> : <p className="muted">Loading…</p>}
      </AppShell>
    );
  }

  const me = data.me;
  const pending = data.members.filter((m) => m.status === "pending_vetting");
  const active = data.members.filter((m) => m.status === "active");
  const emailInvites = invites.filter((i) => i.channel === "email");
  const invitedEmails = new Set(emailInvites.map((i) => i.email?.toLowerCase()));
  // People added through an agenda who aren't members or already shown as invited.
  const listedContacts = contacts.filter((c) => !c.email || !invitedEmails.has(c.email.toLowerCase()));
  const needEmail = listedContacts.filter((c) => !c.email).length;

  /** Mirrors the API's rules so people only see choices that will work. */
  const roleOptions = (target: Member): Role[] => {
    if (!canManage) return [];
    if (target.role === "approver" && me.role !== "approver") return [];
    return me.role === "approver" ? ["approver", "admin", "member"] : ["admin", "member"];
  };
  const canRemove = (target: Member) => target.id === me.membershipId || (canManage && !(target.role === "approver" && me.role !== "approver"));

  const rail = canManage && (
    <>
      <InviteLink
        teamId={teamId}
        enabled={settings?.inviteLinkEnabled ?? true}
        needsLettingIn={settings?.linkRequiresApproval ?? true}
        activeLink={invites.find((i) => i.channel === "link") ?? null}
        onTurnOff={(id) => act(id, () => api(`/teams/${teamId}/invites/${id}`, { method: "DELETE" }), "The invite link has been turned off.")}
        onChanged={load}
      />
      {pending.length > 0 && (
        <section className="panel" aria-labelledby="requests-heading">
          <h2 id="requests-heading">Waiting to join</h2>
          <p className="panel-lead">
            {pending.length} {pending.length === 1 ? "request" : "requests"} from the invite link. Check who they are before letting them in.
          </p>
          <ul className="request-list">
            {pending.map((m) => {
              const name = `${m.user.firstName} ${m.user.lastName}`;
              return (
                <li key={m.id}>
                  <div className="request-person">
                    <Avatar name={name} size={28} />
                    <span>
                      <span className="list-name">{name}</span>
                      <span className="list-sub">{m.user.email}</span>
                    </span>
                  </div>
                  <div className="rail-actions rail-actions-row">
                    <button
                      type="button"
                      className="button button-primary button-small"
                      disabled={busyId === m.id}
                      onClick={() => act(m.id, () => api(`/teams/${teamId}/members/${m.id}/approve`, { method: "POST", body: {} }), `${m.user.firstName} has joined the team.`)}
                    >
                      Let in
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      disabled={busyId === m.id}
                      onClick={() => act(m.id, () => api(`/teams/${teamId}/members/${m.id}`, { method: "DELETE" }), `Declined ${m.user.firstName}'s request.`)}
                    >
                      Decline
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );

  return (
    <AppShell rail={rail || undefined}>
      <h1>People</h1>
      <Alert>{error}</Alert>

      <section className="settings-section" aria-labelledby="roles-heading">
        <div className="section-head">
          <h2 id="roles-heading">Roles</h2>
          <HelpTip label="Roles">
            Only Approvers can make someone else an Approver. People who join through the invite link start as Members.
          </HelpTip>
        </div>
        <p>
          <strong>Approvers</strong> can do everything Admins can, and approve programs. <strong>Admins</strong> create and edit events and manage people.{" "}
          <strong>Members</strong> can be given parts in events.
        </p>
      </section>

      {canManage && (
        <InviteByEmail
          teamId={teamId}
          myRole={me.role}
          defaultRole={settings?.inviteDefaultRole ?? "member"}
          expiryDays={settings?.inviteExpiryDays ?? 7}
          onInvited={async (email) => {
            toast.success(`Invitation sent to ${email}`);
            await load();
          }}
        />
      )}

      <section className="settings-section" aria-labelledby="members-heading">
        <div className="section-head">
          <h2 id="members-heading">Everyone</h2>
          <span className="count">{active.length + emailInvites.length + listedContacts.length}</span>
          <span className="section-head-grow" />
          <span className="section-head-meta">
            {active.length} joined
            {emailInvites.length > 0 && ` · ${emailInvites.length} invited`}
            {needEmail > 0 && ` · ${needEmail} ${needEmail === 1 ? "needs" : "need"} an email`}
          </span>
        </div>
        <ul className="list list-ruled">
          {active.map((m) => {
            const isMe = m.id === me.membershipId;
            const options = roleOptions(m);
            const name = `${m.user.firstName} ${m.user.lastName}`;
            return (
              <li key={m.id} className="list-row">
                <Avatar name={name} size={34} />
                <span className="list-main">
                  <span className="list-name">
                    {name}
                    {isMe && <span className="muted"> (you)</span>}
                  </span>
                  <span className="list-sub">{m.user.email}</span>
                </span>
                <span className="list-meta">
                  <span className="list-status">
                    <Icon name="check" className="tone-good-text" /> Joined
                  </span>
                  <span>{relativeDay(m.joinedAt, viewerZone)}</span>
                </span>
                <span className="list-actions">
                  {options.length > 0 ? (
                    <label>
                      <span className="visually-hidden">Role for {m.user.firstName}</span>
                      <select
                        className="select select-small"
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
                    <span className="role-text" title={ROLE_HELP[m.role]}>
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
                        <button type="button" className="button button-small button-soft" onClick={() => setConfirmingRemove(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button type="button" className="button button-small button-secondary" onClick={() => setConfirmingRemove(m.id)}>
                        {isMe ? "Leave" : "Remove"}
                      </button>
                    ))}
                </span>
              </li>
            );
          })}

          {emailInvites.map((i) => (
            <li key={i.id} className="list-row">
              <Avatar name={i.email ?? "?"} size={34} />
              <span className="list-main">
                <span className="list-name">{i.email}</span>
                <span className="list-sub">
                  {ROLE_LABEL[i.role]} · invited by {i.invitedBy}
                </span>
              </span>
              <span className="list-meta">
                <span className="list-status">
                  <Icon name="clock" className="tone-warn-text" /> Invited
                </span>
                <span>expires {relativeDay(i.expiresAt, viewerZone)}</span>
              </span>
              <span className="list-actions">
                <button
                  type="button"
                  className="button button-small button-secondary"
                  disabled={busyId === i.id}
                  onClick={() => act(i.id, () => api(`/teams/${teamId}/invites/${i.id}`, { method: "DELETE" }), `Cancelled the invitation to ${i.email}.`)}
                >
                  Cancel invite
                </button>
              </span>
            </li>
          ))}

          {listedContacts.map((c) => (
            <li key={c.contactId} className="list-row">
              <Avatar name={c.name} size={34} />
              <span className="list-main">
                <span className="list-name">{c.name}</span>
                <span className="list-sub">{c.email ?? "No email yet"}</span>
              </span>
              <span className="list-meta">
                {c.email ? (
                  <span className="list-status">
                    <Icon name="clock" className="tone-muted-text" /> Invited when a program is approved
                  </span>
                ) : (
                  <span className="list-status">
                    <Icon name="warn" className="tone-bad-text" /> Needs an email
                  </span>
                )}
                <span>added from an agenda</span>
              </span>
              <span className="list-actions" />
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}

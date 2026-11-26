/**
 * The mobile Inbox: what needs someone's attention, across all their teams.
 *
 * Most items come straight from what's waiting on them and leave once it's handled:
 *  - approve:<eventId>       a program waiting for my approval (Admins)
 *  - join:<membershipId>     someone waiting to be let in through the invite link (Admins and Planners)
 *  - confirm:<participantId> my part on an approved program, not yet confirmed
 *  - invite:<inviteId>       an invitation to join another team, sent to my email
 * The rest are notes about things that happened (a part changed, a program approved
 * or sent back, a comment), kept until opened or dismissed: note:<id>.
 */
import type { Env } from "./env";
import { newId } from "./ids";
import { pushInbox } from "./push";

export type InboxAction = "approve" | "open" | "let_in" | "decline_join" | "confirm" | "decline_part" | "join_team" | "decline_invite" | "dismiss";

export interface InboxItem {
  key: string;
  kind: "approve" | "join" | "confirm" | "invite" | "part_added" | "part_changed" | "part_removed" | "program_approved" | "program_returned" | "comment";
  teamId: string;
  teamName: string;
  eventId: string | null;
  title: string;
  body: string;
  at: string;
  unread: boolean;
  actions: InboxAction[];
  /** What the quick buttons act on. */
  ref: { membershipId?: string; participantId?: string; inviteId?: string; noteId?: string; taskId?: string };
}

export type NoteKind = "part_added" | "part_changed" | "part_removed" | "program_approved" | "program_returned" | "comment";

/** Everything in someone's Inbox, newest first, with how many they haven't seen. */
export async function buildInbox(db: D1Database, user: { id: string; email: string }): Promise<{ items: InboxItem[]; unread: number }> {
  const now = new Date().toISOString();
  const [approvals, joins, confirms, invites, notes, seen] = await Promise.all([
    db
      .prepare(
        `SELECT e.id, e.name, e.start_at, t.id AS team_id, t.name AS team_name,
                (SELECT MAX(sc.changed_at) FROM event_status_changes sc WHERE sc.event_id = e.id AND sc.to_status = 'review') AS sent_at,
                (SELECT u.first_name || ' ' || u.last_name FROM event_status_changes sc JOIN users u ON u.id = sc.changed_by
                  WHERE sc.event_id = e.id AND sc.to_status = 'review' ORDER BY sc.changed_at DESC LIMIT 1) AS sent_by,
                (SELECT sc.changed_by FROM event_status_changes sc WHERE sc.event_id = e.id AND sc.to_status = 'review'
                  ORDER BY sc.changed_at DESC LIMIT 1) AS sent_by_id,
                t.allow_self_approval
           FROM events e
           JOIN teams t ON t.id = e.team_id
           JOIN event_approvers a ON a.event_id = e.id AND a.user_id = ? AND a.approved_at IS NULL
           JOIN team_memberships m ON m.team_id = e.team_id AND m.user_id = a.user_id AND m.status = 'active' AND m.role = 'approver'
          WHERE e.status = 'review'`,
      )
      .bind(user.id)
      .all<{ id: string; name: string; start_at: string; team_id: string; team_name: string; sent_at: string | null; sent_by: string | null; sent_by_id: string | null; allow_self_approval: number }>(),
    db
      .prepare(
        `SELECT p.id, p.created_at, u.first_name, u.last_name, u.email, t.id AS team_id, t.name AS team_name
           FROM team_memberships p
           JOIN users u ON u.id = p.user_id
           JOIN teams t ON t.id = p.team_id
           JOIN team_memberships me ON me.team_id = p.team_id AND me.user_id = ? AND me.status = 'active' AND me.role IN ('approver', 'admin')
          WHERE p.status = 'pending_vetting'`,
      )
      .bind(user.id)
      .all<{ id: string; created_at: string; first_name: string; last_name: string; email: string; team_id: string; team_name: string }>(),
    db
      .prepare(
        `SELECT p.id, e.id AS event_id, e.name, e.start_at, e.timezone, t.id AS team_id, t.name AS team_name,
                (SELECT MAX(sc.changed_at) FROM event_status_changes sc WHERE sc.event_id = e.id AND sc.to_status = 'approved') AS approved_at,
                (SELECT COUNT(*) FROM task_assignments a WHERE a.participant_id = p.id) AS parts
           FROM event_participants p
           JOIN events e ON e.id = p.event_id
           JOIN teams t ON t.id = e.team_id
          WHERE p.user_id = ? AND p.response = 'pending' AND e.status IN ('approved', 'live') AND e.end_at > ?`,
      )
      .bind(user.id, now)
      .all<{ id: string; event_id: string; name: string; start_at: string; timezone: string; team_id: string; team_name: string; approved_at: string | null; parts: number }>(),
    db
      .prepare(
        `SELECT i.id, i.role, i.created_at, t.id AS team_id, t.name AS team_name, u.first_name || ' ' || u.last_name AS invited_by
           FROM team_invites i
           JOIN teams t ON t.id = i.team_id
           JOIN users u ON u.id = i.created_by
          WHERE i.channel = 'email' AND i.status = 'pending' AND i.expires_at > ? AND lower(i.recipient) = lower(?)
            AND NOT EXISTS (SELECT 1 FROM team_memberships m JOIN users me ON me.id = m.user_id
                             WHERE m.team_id = i.team_id AND lower(me.email) = lower(?) AND m.status = 'active')`,
      )
      .bind(now, user.email, user.email)
      .all<{ id: string; role: string; created_at: string; team_id: string; team_name: string; invited_by: string }>(),
    db
      .prepare(
        `SELECT n.id, n.kind, n.title, n.body, n.created_at, n.event_id, n.task_id, t.id AS team_id, t.name AS team_name
           FROM inbox_notes n JOIN teams t ON t.id = n.team_id
          WHERE n.user_id = ? AND n.done_at IS NULL
          ORDER BY n.created_at DESC LIMIT 100`,
      )
      .bind(user.id)
      .all<{ id: string; kind: NoteKind; title: string; body: string; created_at: string; event_id: string | null; task_id: string | null; team_id: string; team_name: string }>(),
    db.prepare("SELECT key FROM inbox_seen WHERE user_id = ?").bind(user.id).all<{ key: string }>(),
  ]);

  const seenKeys = new Set(seen.results.map((r) => r.key));
  const ROLE = { approver: "an Admin", admin: "a Planner", member: "a Member" } as Record<string, string>;
  const items: Omit<InboxItem, "unread">[] = [
    ...approvals.results
      // Teams can stop people approving programs they sent themselves.
      .filter((e) => e.allow_self_approval === 1 || e.sent_by_id !== user.id)
      .map((e) => ({
        key: `approve:${e.id}`,
        kind: "approve" as const,
        teamId: e.team_id,
        teamName: e.team_name,
        eventId: e.id,
        title: `${e.name} is waiting for your approval`,
        body: e.sent_by ? `Sent by ${e.sent_by}. Everyone on it is emailed once it's approved.` : "Everyone on it is emailed once it's approved.",
        at: e.sent_at ?? e.start_at,
        actions: ["approve", "open"] as InboxAction[],
        ref: {},
      })),
    ...joins.results.map((j) => ({
      key: `join:${j.id}`,
      kind: "join" as const,
      teamId: j.team_id,
      teamName: j.team_name,
      eventId: null,
      title: `${j.first_name} ${j.last_name} wants to join ${j.team_name}`,
      body: `${j.email} used the invite link. Check who they are before letting them in.`,
      at: j.created_at,
      actions: ["let_in", "decline_join"] as InboxAction[],
      ref: { membershipId: j.id },
    })),
    ...confirms.results.map((p) => ({
      key: `confirm:${p.id}`,
      kind: "confirm" as const,
      teamId: p.team_id,
      teamName: p.team_name,
      eventId: p.event_id,
      title: `You're on the program for ${p.name}`,
      body: p.parts ? `You have ${p.parts} part${p.parts === 1 ? "" : "s"}. Let the team know you'll be there.` : "Let the team know you'll be there.",
      at: p.approved_at ?? p.start_at,
      actions: ["confirm", "decline_part", "open"] as InboxAction[],
      ref: { participantId: p.id },
    })),
    ...invites.results.map((i) => ({
      key: `invite:${i.id}`,
      kind: "invite" as const,
      teamId: i.team_id,
      teamName: i.team_name,
      eventId: null,
      title: `Join ${i.team_name}`,
      body: `${i.invited_by} invited you to join as ${ROLE[i.role] ?? "a Member"}.`,
      at: i.created_at,
      actions: ["join_team", "decline_invite"] as InboxAction[],
      ref: { inviteId: i.id },
    })),
    ...notes.results.map((n) => ({
      key: `note:${n.id}`,
      kind: n.kind,
      teamId: n.team_id,
      teamName: n.team_name,
      eventId: n.event_id,
      title: n.title,
      body: n.body,
      at: n.created_at,
      actions: (n.event_id ? ["open", "dismiss"] : ["dismiss"]) as InboxAction[],
      ref: { noteId: n.id, taskId: n.task_id ?? undefined },
    })),
  ];
  const withUnread = items.map((i) => ({ ...i, unread: !seenKeys.has(i.key) })).sort((a, b) => b.at.localeCompare(a.at));
  return { items: withUnread, unread: withUnread.filter((i) => i.unread).length };
}

/** Marks Inbox items as seen (for the unread count). They stay until handled. */
export async function markSeen(db: D1Database, userId: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db.batch(keys.map((k) => db.prepare("INSERT OR IGNORE INTO inbox_seen (user_id, key) VALUES (?, ?)").bind(userId, k)));
}

/**
 * Tells people something happened: a note in their Inbox, and a push to their phones.
 * `userIds` are team members; the person who did it should already be left out.
 */
export async function notifyNote(
  env: Pick<Env, "DB" | "EXPO_ACCESS_TOKEN">,
  userIds: string[],
  note: { kind: NoteKind; teamId: string; eventId?: string | null; taskId?: string | null; title: string; body: string },
): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  const rows = ids.map((userId) => ({ id: newId(), userId }));
  await env.DB.batch(
    rows.map((r) =>
      env.DB.prepare("INSERT INTO inbox_notes (id, user_id, team_id, event_id, task_id, kind, title, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(
        r.id,
        r.userId,
        note.teamId,
        note.eventId ?? null,
        note.taskId ?? null,
        note.kind,
        note.title,
        note.body,
      ),
    ),
  );
  await Promise.all(rows.map((r) => pushInbox(env, [r.userId], { title: note.title, body: note.body, inboxKey: `note:${r.id}` })));
}

/** A push about something now waiting in people's Inbox (an approval, a join request, a part, an invite). */
export async function notifyWaiting(env: Pick<Env, "DB" | "EXPO_ACCESS_TOKEN">, userIds: string[], item: { key: string; title: string; body: string }): Promise<void> {
  await pushInbox(env, userIds, { title: item.title, body: item.body, inboxKey: item.key });
}

/**
 * Deleting an account (App Store guideline 5.1.1(v); Settings on the web, Profile on the phone).
 *
 * The user row stays, because programs, comments, approvals and broadcasts the team keeps point
 * at it, but everything personal is wiped: name becomes "Deleted user", the email is replaced
 * so the address is free to sign up again, the password can never match, and their sessions,
 * devices, Inbox, Archived and memberships go. Teams where they're the only member are deleted.
 * Someone who is the last Admin of a team with other people must hand over first.
 */
export interface Blocker {
  teamId: string;
  teamName: string;
}

/** Teams that would be left with people but no Admin. */
export async function deletionBlockers(db: D1Database, userId: string): Promise<Blocker[]> {
  const { results } = await db
    .prepare(
      `SELECT t.id AS team_id, t.name AS team_name FROM team_memberships m JOIN teams t ON t.id = m.team_id
        WHERE m.user_id = ? AND m.status = 'active' AND m.role = 'approver'
          AND EXISTS (SELECT 1 FROM team_memberships o WHERE o.team_id = m.team_id AND o.user_id <> m.user_id AND o.status = 'active')
          AND NOT EXISTS (SELECT 1 FROM team_memberships o WHERE o.team_id = m.team_id AND o.user_id <> m.user_id AND o.status = 'active' AND o.role = 'approver')`,
    )
    .bind(userId)
    .all<{ team_id: string; team_name: string }>();
  return results.map((r) => ({ teamId: r.team_id, teamName: r.team_name }));
}

export async function deleteAccount(db: D1Database, userId: string, now: string): Promise<{ teamsDeleted: number }> {
  // Teams they'd leave empty go with them.
  const { results: solo } = await db
    .prepare(
      `SELECT m.team_id FROM team_memberships m WHERE m.user_id = ? AND m.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM team_memberships o WHERE o.team_id = m.team_id AND o.user_id <> m.user_id AND o.status IN ('active', 'pending_vetting'))`,
    )
    .bind(userId)
    .all<{ team_id: string }>();

  const wipe = (table: string) => db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId);
  await db.batch([
    ...solo.map((t) => db.prepare("DELETE FROM teams WHERE id = ?").bind(t.team_id)),
    wipe("sessions"),
    wipe("auth_tokens"),
    wipe("device_tokens"),
    wipe("live_activity_tokens"),
    wipe("live_cards"),
    wipe("inbox_notes"),
    wipe("inbox_seen"),
    wipe("inbox_archive"),
    wipe("team_memberships"),
    // Approvals they still owed; approvals they gave stay on the record.
    db.prepare("DELETE FROM event_approvers WHERE user_id = ? AND approved_at IS NULL").bind(userId),
    db.prepare("DELETE FROM team_invites WHERE lower(recipient) = (SELECT lower(email) FROM users WHERE id = ?)").bind(userId),
    db
      .prepare(
        `UPDATE users SET first_name = 'Deleted', last_name = 'user', email = ?, phone = NULL, email_verified_at = NULL,
           password_hash = '!deleted', deleted_at = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(`deleted-${userId}@deleted.invalid`, now, now, userId),
  ]);
  return { teamsDeleted: solo.length };
}

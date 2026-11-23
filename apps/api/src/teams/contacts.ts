/**
 * The team's people list for agendas: members plus contacts (people typed into an
 * agenda who aren't on the team yet), and inviting contacts once a program they're
 * on is approved.
 */
import { newSecretToken, sha256Hex } from "../auth/crypto";
import { newId, nowIso } from "../ids";
import { teamInviteEmail, type OutgoingEmail } from "../mail";

const INVITE_DAYS = 7;

export interface ContactRow {
  id: string;
  team_id: string;
  name: string;
  email: string | null;
  created_by: string | null;
  invited_at: string | null;
}

/** Contacts on this event's program who haven't got an email yet, by name. */
export async function contactsMissingEmail(db: D1Database, eventId: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT p.guest_name AS name FROM event_participants p
        WHERE p.event_id = ? AND p.user_id IS NULL AND (p.guest_email IS NULL OR p.guest_email = '')
        ORDER BY p.guest_name`,
    )
    .bind(eventId)
    .all<{ name: string }>();
  return results.map((r) => r.name);
}

/** "Ada", "Ada and Bola", "Ada, Bola and Chi". */
export function listNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Invites to the team every contact on this event's program who hasn't been invited
 * yet (and isn't already a member). Called when the program is approved, and when
 * people are added to an approved program. Returns how many were invited.
 */
export async function inviteContactsOnProgram(
  db: D1Database,
  hooks: { appOrigin: string; send: (email: OutgoingEmail) => Promise<unknown> },
  eventId: string,
  fallbackInviterId: string,
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT c.id, c.team_id, c.name, c.email, c.created_by, t.name AS team_name
         FROM event_participants p
         JOIN team_contacts c ON c.id = p.contact_id
         JOIN teams t ON t.id = c.team_id
        WHERE p.event_id = ? AND c.email IS NOT NULL AND c.email <> '' AND c.invited_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM team_memberships m JOIN users u ON u.id = m.user_id
             WHERE m.team_id = c.team_id AND u.email = c.email AND m.status = 'active'
          )`,
    )
    .bind(eventId)
    .all<ContactRow & { team_name: string }>();

  let sent = 0;
  for (const contact of results) {
    const inviterId = contact.created_by ?? fallbackInviterId;
    const inviter = await db
      .prepare("SELECT first_name || ' ' || last_name AS name FROM users WHERE id = ?")
      .bind(inviterId)
      .first<{ name: string }>();
    const token = newSecretToken();
    const now = nowIso();
    await db.batch([
      // A newer invitation replaces any earlier one to the same address.
      db
        .prepare("UPDATE team_invites SET status = 'revoked', updated_at = ? WHERE team_id = ? AND channel = 'email' AND recipient = ? AND status = 'pending'")
        .bind(now, contact.team_id, contact.email),
      db
        .prepare(
          `INSERT INTO team_invites (id, team_id, channel, recipient, role, token_hash, expires_at, created_by)
           VALUES (?, ?, 'email', ?, 'member', ?, ?, ?)`,
        )
        .bind(newId(), contact.team_id, contact.email, await sha256Hex(token), new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString(), inviterId),
      db.prepare("UPDATE team_contacts SET invited_at = ?, updated_at = ? WHERE id = ?").bind(now, now, contact.id),
    ]);
    await hooks
      .send({ to: contact.email!, ...teamInviteEmail(inviter?.name ?? "Your organiser", contact.team_name, "member", `${hooks.appOrigin}/invite/${token}`) })
      .catch((err) => console.error("Contact invite failed", err));
    sent++;
  }
  return sent;
}

/**
 * Once someone joins the team, they stop being a guest on the team's programs:
 * their guest places become member places (unless they're already on that event),
 * and their personal guest links stop working, since they now use the app.
 */
export async function linkGuestPlacesToMember(db: D1Database, teamId: string, userId: string, email: string): Promise<void> {
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `UPDATE guest_access_links SET revoked_at = ?
          WHERE revoked_at IS NULL AND participant_id IN (
            SELECT p.id FROM event_participants p JOIN events e ON e.id = p.event_id
             WHERE e.team_id = ? AND p.user_id IS NULL AND p.guest_email = ? COLLATE NOCASE
          )`,
      )
      .bind(now, teamId, email),
    db
      .prepare(
        `UPDATE event_participants SET user_id = ?, guest_name = NULL, guest_email = NULL, contact_id = NULL, updated_at = ?
          WHERE user_id IS NULL AND guest_email = ? COLLATE NOCASE
            AND event_id IN (SELECT id FROM events WHERE team_id = ?)
            AND event_id NOT IN (SELECT event_id FROM event_participants WHERE user_id = ?)`,
      )
      .bind(userId, now, email, teamId, userId),
  ]);
}

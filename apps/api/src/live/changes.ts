/**
 * Telling people about changes to an approved or live event.
 *
 * At approval, we record what each person on the program was told (their
 * tasks and times, plus the event's name and time). After later edits, once
 * things have been quiet for 2 minutes, we compare each person's part with
 * what they were told and email only those whose part changed, plus anyone
 * newly added (guests get their personal link) or removed.
 */
import { inviteContactsOnProgram } from "../teams/contacts";
import { newSecretToken, sha256Hex } from "../auth/crypto";
import {
  assignedEmail,
  formatClockTime,
  formatEventTime,
  guestInviteEmail,
  planChangedEmail,
  removedFromProgramEmail,
  type OutgoingEmail,
} from "../mail";

/** Quiet period after the last edit before people are notified. */
export const NOTIFY_DELAY_MS = 2 * 60_000;

export interface NotifyHooks {
  appOrigin: string;
  send: (email: OutgoingEmail) => Promise<unknown>;
}

interface Part {
  participantId: string;
  kind: "member" | "guest";
  name: string;
  firstName: string;
  email: string;
  lines: string[];
  summary: string;
}

interface EventInfo {
  id: string;
  name: string;
  team_name: string;
  start_at: string;
  end_at: string;
  timezone: string;
  status: string;
  notify_after: string | null;
}

async function loadEvent(db: D1Database, eventId: string): Promise<EventInfo | null> {
  return db
    .prepare(
      `SELECT e.id, e.name, t.name AS team_name, e.start_at, e.end_at, e.timezone, e.status, e.notify_after
         FROM events e JOIN teams t ON t.id = e.team_id WHERE e.id = ?`,
    )
    .bind(eventId)
    .first<EventInfo>();
}

/** Each person's current part, in the event's time zone. */
async function currentParts(db: D1Database, event: EventInfo): Promise<Part[]> {
  const { results: people } = await db
    .prepare(
      `SELECT p.id, p.user_id, p.guest_name, p.guest_email, u.first_name, u.last_name, u.email
         FROM event_participants p LEFT JOIN users u ON u.id = p.user_id
        WHERE p.event_id = ?`,
    )
    .bind(event.id)
    .all<{ id: string; user_id: string | null; guest_name: string | null; guest_email: string | null; first_name: string | null; last_name: string | null; email: string | null }>();
  const { results: assignments } = await db
    .prepare(
      `SELECT a.participant_id, t.title, t.planned_start_at FROM task_assignments a JOIN tasks t ON t.id = a.task_id
        WHERE t.event_id = ? AND t.status IN ('upcoming', 'in_progress') ORDER BY t.sort_order`,
    )
    .bind(event.id)
    .all<{ participant_id: string; title: string; planned_start_at: string }>();

  return people.map((p) => {
    const lines = assignments
      .filter((a) => a.participant_id === p.id)
      .map((a) => `${formatClockTime(a.planned_start_at, event.timezone)}  ${a.title}`);
    const member = p.user_id !== null;
    return {
      participantId: p.id,
      kind: member ? "member" : "guest",
      name: member ? `${p.first_name} ${p.last_name}` : p.guest_name!,
      firstName: member ? p.first_name! : p.guest_name!,
      email: member ? p.email! : (p.guest_email ?? ""),
      lines,
      // Anything that should trigger a notice when it changes. Not the end time: it follows
      // the agenda, so a change there already shows in the person's own lines.
      summary: JSON.stringify({ event: event.name, start: event.start_at, tz: event.timezone, lines }),
    };
  });
}

/** Compares two summaries, ignoring the end time that older summaries recorded. */
function sameSummary(a: string, b: string): boolean {
  const strip = (s: string) => {
    try {
      const { end: _end, ...rest } = JSON.parse(s) as Record<string, unknown>;
      return JSON.stringify(rest);
    } catch {
      return s;
    }
  };
  return strip(a) === strip(b);
}

/** Record what everyone has now been told. */
export async function writeBaseline(db: D1Database, eventId: string, now = Date.now()): Promise<void> {
  const event = await loadEvent(db, eventId);
  if (!event) return;
  // People without an email yet can't be told anything (approved programs need one).
  const parts = (await currentParts(db, event)).filter((p) => p.email);
  await db.batch([
    db.prepare("DELETE FROM plan_notices WHERE event_id = ?").bind(eventId),
    ...parts.map((p) =>
      db
        .prepare(
          "INSERT INTO plan_notices (event_id, participant_id, kind, name, email, summary, lines, notified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(eventId, p.participantId, p.kind, p.firstName, p.email, p.summary, JSON.stringify(p.lines), new Date(now).toISOString()),
    ),
  ]);
}

/** Create (or replace) a guest's personal link. Returns the token to put in the email. */
export async function createGuestLink(db: D1Database, participantId: string, expiresAt: string, now = Date.now()): Promise<string> {
  const token = newSecretToken();
  await db.batch([
    db.prepare("UPDATE guest_access_links SET revoked_at = ? WHERE participant_id = ? AND revoked_at IS NULL").bind(new Date(now).toISOString(), participantId),
    db
      .prepare("INSERT INTO guest_access_links (id, participant_id, token_hash, expires_at) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), participantId, await sha256Hex(token), expiresAt),
  ]);
  return token;
}

/** Start (or restart) the 2-minute quiet period after an edit. */
export async function markChanged(db: D1Database, eventId: string, now = Date.now()): Promise<void> {
  await db
    .prepare("UPDATE events SET notify_after = ? WHERE id = ? AND status IN ('approved', 'live')")
    .bind(new Date(now + NOTIFY_DELAY_MS).toISOString(), eventId)
    .run();
}

/** When pending notifications are due, if any. */
export async function notifyDueAt(db: D1Database, eventId: string): Promise<number | null> {
  const row = await db.prepare("SELECT notify_after FROM events WHERE id = ?").bind(eventId).first<{ notify_after: string | null }>();
  return row?.notify_after ? Date.parse(row.notify_after) : null;
}

/** Send the notices that are due. Returns how many emails went out. */
export async function flushChanges(db: D1Database, eventId: string, now: number, hooks: NotifyHooks): Promise<number> {
  const event = await loadEvent(db, eventId);
  if (!event?.notify_after || Date.parse(event.notify_after) > now) return 0;

  // Claim the batch first, so two wake-ups can't both send it.
  const claimed = await db
    .prepare("UPDATE events SET notify_after = NULL WHERE id = ? AND notify_after = ?")
    .bind(eventId, event.notify_after)
    .run();
  if (!claimed.meta.changes) return 0;
  if (event.status !== "approved" && event.status !== "live") return 0;

  const { results: told } = await db
    .prepare("SELECT participant_id, kind, name, email, summary, lines FROM plan_notices WHERE event_id = ?")
    .bind(eventId)
    .all<{ participant_id: string; kind: string; name: string; email: string; summary: string; lines: string }>();
  const before = new Map(told.map((t) => [t.participant_id, t]));
  const parts = await currentParts(db, event);
  const when = formatEventTime(event.start_at, event.timezone);
  const eventLink = `${hooks.appOrigin}/admin/events/${event.id}`;

  const emails: OutgoingEmail[] = [];
  for (const p of parts) {
    const previous = before.get(p.participantId);
    if (!previous) {
      // Newly added since approval: same welcome as at approval.
      if (p.kind === "member") {
        emails.push({ to: p.email, ...assignedEmail(p.firstName, event.team_name, event.name, when, p.lines, eventLink) });
      } else {
        const token = await createGuestLink(db, p.participantId, event.end_at, now);
        emails.push({ to: p.email, ...guestInviteEmail(p.firstName, event.team_name, event.name, when, p.lines, `${hooks.appOrigin}/g/${token}`) });
      }
    } else if (!sameSummary(previous.summary, p.summary)) {
      // Guests' links are stored only as hashes, so each change email carries a fresh one (replacing the old).
      const link = p.kind === "member" ? eventLink : `${hooks.appOrigin}/g/${await createGuestLink(db, p.participantId, event.end_at, now)}`;
      emails.push({ to: p.email, ...planChangedEmail(p.firstName, event.name, when, p.lines, JSON.parse(previous.lines) as string[], link) });
    }
  }
  const current = new Set(parts.map((p) => p.participantId));
  for (const t of told) {
    if (!current.has(t.participant_id)) emails.push({ to: t.email, ...removedFromProgramEmail(t.name, event.name, when) });
  }

  await writeBaseline(db, eventId, now);
  for (const e of emails) await hooks.send(e).catch((err) => console.error("Change notice failed", err));
  // People new to the team who were just added are invited to join it too.
  const creator = await db.prepare("SELECT created_by FROM events WHERE id = ?").bind(eventId).first<{ created_by: string }>();
  if (creator) await inviteContactsOnProgram(db, hooks, eventId, creator.created_by);
  return emails.length;
}


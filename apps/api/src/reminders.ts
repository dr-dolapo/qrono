import type { Env } from "./env";
import { formatClockTime, formatEventTime, reminderEmail, sendEmail } from "./mail";
import { emailBrand, parseOffsets } from "./teams/settings";

const MINUTE = 60_000;
/** Far enough ahead to cover the longest reminder (1 week), plus the time between runs. */
const LOOKAHEAD = 7 * 24 * 60 * MINUTE + 15 * MINUTE;

/** How long after its moment a reminder is still worth sending: a quarter of its lead time, at least 15 minutes. */
const graceFor = (offsetMinutes: number) => Math.max(15, offsetMinutes / 4) * MINUTE;

/** "tomorrow", "in 3 hours", "in 45 minutes" — from the actual time left. */
export function leadText(msLeft: number): string {
  const minutes = Math.round(msLeft / MINUTE);
  if (minutes >= 6 * 24 * 60) return "next week";
  if (minutes >= 36 * 60) return `in ${Math.round(minutes / 1440)} days`;
  if (minutes >= 18 * 60) return "tomorrow";
  if (minutes >= 90) return `in ${Math.round(minutes / 60)} hours`;
  if (minutes >= 50) return "in 1 hour";
  return `in ${Math.max(1, Math.round(minutes / 5) * 5)} minutes`;
}

interface DueEvent {
  id: string;
  name: string;
  start_at: string;
  timezone: string;
  team_id: string;
  team_name: string;
  logo_data: string | null;
  default_venue: string | null;
  clock_format: "12h" | "24h";
  reminder_offsets: string;
}

/**
 * Sends the reminders that are due. Runs every few minutes (a cron trigger).
 * Everyone on an approved program gets them, except team members who turned
 * reminders off for themselves. Each reminder is claimed before it's sent, so
 * overlapping runs never send it twice. Returns how many emails went out.
 */
export async function sendDueReminders(env: Env, now = Date.now()): Promise<number> {
  const db = env.DB;
  const { results: events } = await db
    .prepare(
      `SELECT e.id, e.name, e.start_at, e.timezone, t.id AS team_id, t.name AS team_name, t.logo_data, t.default_venue,
              t.clock_format, t.reminder_offsets
         FROM events e JOIN teams t ON t.id = e.team_id
        WHERE e.status = 'approved' AND t.reminders_enabled = 1 AND e.start_at > ? AND e.start_at <= ?`,
    )
    .bind(new Date(now).toISOString(), new Date(now + LOOKAHEAD).toISOString())
    .all<DueEvent>();

  let sent = 0;
  for (const event of events) {
    const start = Date.parse(event.start_at);
    const due = parseOffsets(event.reminder_offsets).filter((o) => now >= start - o * MINUTE);
    if (!due.length) continue;

    // Claim every reminder that has come due; send only if one is still fresh.
    let fresh = false;
    for (const offset of due) {
      const claim = await db.prepare("INSERT OR IGNORE INTO reminders_sent (event_id, offset_minutes) VALUES (?, ?)").bind(event.id, offset).run();
      if (claim.meta.changes && now - (start - offset * MINUTE) <= graceFor(offset)) fresh = true;
    }
    if (!fresh) continue;
    sent += await remindEveryone(env, event, now);
  }
  return sent;
}

async function remindEveryone(env: Env, event: DueEvent, now: number): Promise<number> {
  const db = env.DB;
  const [{ results: people }, { results: assignments }] = await Promise.all([
    db
      .prepare(
        `SELECT p.id, p.user_id, p.guest_name, p.guest_email, u.first_name, u.email,
                COALESCE(m.reminder_emails, 1) AS wants
           FROM event_participants p
           LEFT JOIN users u ON u.id = p.user_id
           LEFT JOIN team_memberships m ON m.user_id = p.user_id AND m.team_id = ? AND m.status = 'active'
          WHERE p.event_id = ?`,
      )
      .bind(event.team_id, event.id)
      .all<{ id: string; user_id: string | null; guest_name: string | null; guest_email: string | null; first_name: string | null; email: string | null; wants: number }>(),
    db
      .prepare(
        `SELECT a.participant_id, t.title, t.planned_start_at FROM task_assignments a JOIN tasks t ON t.id = a.task_id
          WHERE t.event_id = ? ORDER BY t.sort_order`,
      )
      .bind(event.id)
      .all<{ participant_id: string; title: string; planned_start_at: string }>(),
  ]);

  const when = formatEventTime(event.start_at, event.timezone, event.clock_format);
  const lead = leadText(Date.parse(event.start_at) - now);
  const brand = emailBrand(env.APP_ORIGIN, { id: event.team_id, name: event.team_name, logo_data: event.logo_data, default_venue: event.default_venue });
  let count = 0;
  for (const p of people) {
    const member = p.user_id !== null;
    const to = member ? p.email : p.guest_email;
    if (!to || (member && p.wants === 0)) continue;
    const tasks = assignments
      .filter((a) => a.participant_id === p.id)
      .map((a) => `${formatClockTime(a.planned_start_at, event.timezone, event.clock_format)}  ${a.title}`);
    // Guests' links are only stored as hashes; their earlier email has the link, so none is made here.
    const link = member ? `${env.APP_ORIGIN}/admin/events/${event.id}` : null;
    const ok = await sendEmail(env, { to, ...reminderEmail(member ? p.first_name! : p.guest_name!, event.name, when, lead, tasks, link, brand, member) });
    if (ok) count++;
  }
  return count;
}

/**
 * The Inbox's Archived list. When someone deals with an Inbox item (approves, confirms,
 * lets someone in, dismisses a note…), from the app or the web, it's recorded here so they
 * can look back. Kept for 60 days; the cron clears older rows.
 */
export const ARCHIVE_DAYS = 60;

export type ArchiveOutcome =
  | "approved"
  | "confirmed"
  | "declined_part"
  | "let_in"
  | "declined_join"
  | "joined_team"
  | "declined_invite"
  | "opened"
  | "dismissed";

export interface ArchiveEntry {
  userId: string;
  key: string;
  teamId: string | null;
  eventId?: string | null;
  outcome: ArchiveOutcome;
  title: string;
  detail?: string | null;
}

export interface ArchivedItem {
  key: string;
  outcome: ArchiveOutcome;
  title: string;
  detail: string | null;
  teamName: string | null;
  eventId: string | null;
  at: string;
}

const cutoff = (now = Date.now()) => new Date(now - ARCHIVE_DAYS * 86_400_000).toISOString();

/** Records what was done. Doing something else with the same item later replaces it. */
export async function archive(db: D1Database, e: ArchiveEntry, now = new Date().toISOString()): Promise<void> {
  await db
    .prepare(
      `INSERT INTO inbox_archive (user_id, key, team_id, event_id, outcome, title, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, key) DO UPDATE SET outcome = excluded.outcome, title = excluded.title,
         detail = excluded.detail, event_id = excluded.event_id, created_at = excluded.created_at`,
    )
    .bind(e.userId, e.key, e.teamId, e.eventId ?? null, e.outcome, e.title.slice(0, 200), e.detail?.slice(0, 500) ?? null, now)
    .run();
}

/** The last 60 days, newest first. */
export async function listArchive(db: D1Database, userId: string, now = Date.now()): Promise<ArchivedItem[]> {
  const { results } = await db
    .prepare(
      `SELECT a.key, a.outcome, a.title, a.detail, t.name AS team_name, a.event_id, a.created_at
         FROM inbox_archive a LEFT JOIN teams t ON t.id = a.team_id
        WHERE a.user_id = ? AND a.created_at >= ?
        ORDER BY a.created_at DESC LIMIT 500`,
    )
    .bind(userId, cutoff(now))
    .all<{ key: string; outcome: ArchiveOutcome; title: string; detail: string | null; team_name: string | null; event_id: string | null; created_at: string }>();
  return results.map((r) => ({
    key: r.key,
    outcome: r.outcome,
    title: r.title,
    detail: r.detail,
    teamName: r.team_name,
    eventId: r.event_id,
    at: r.created_at,
  }));
}

/** Cron: clears anything older than 60 days. */
export async function pruneArchive(db: D1Database, now = Date.now()): Promise<number> {
  const res = await db.prepare("DELETE FROM inbox_archive WHERE created_at < ?").bind(cutoff(now)).run();
  return res.meta.changes ?? 0;
}

/**
 * Broadcasts during a live event (PRD §9.6, QR038–QR042).
 * Plain functions over D1 so they're testable without a Durable Object.
 */

export const SNOOZE_MS = 3 * 60_000;

export interface BroadcastMessage {
  type: "broadcast";
  broadcast: { id: string; body: string; sentBy: string; sentAt: string; realert: boolean };
}

/** The alert a recipient's screen shows. */
export async function broadcastMessage(db: D1Database, broadcastId: string, realert = false): Promise<BroadcastMessage | null> {
  const b = await db
    .prepare(
      `SELECT b.id, b.body, b.sent_at, u.first_name || ' ' || u.last_name AS sent_by
         FROM broadcasts b JOIN users u ON u.id = b.sent_by WHERE b.id = ?`,
    )
    .bind(broadcastId)
    .first<{ id: string; body: string; sent_at: string; sent_by: string }>();
  if (!b) return null;
  return { type: "broadcast", broadcast: { id: b.id, body: b.body, sentBy: b.sent_by, sentAt: b.sent_at, realert } };
}

export async function recipientIds(db: D1Database, broadcastId: string): Promise<string[]> {
  const { results } = await db.prepare("SELECT user_id FROM broadcast_receipts WHERE broadcast_id = ?").bind(broadcastId).all<{ user_id: string }>();
  return results.map((r) => r.user_id);
}

/**
 * Snoozed alerts whose 3 minutes are up go back to "waiting for a reply"
 * and are delivered again. Returns who to re-alert.
 */
export async function releaseDueSnoozes(db: D1Database, eventId: string, now: number): Promise<{ userId: string; broadcastId: string }[]> {
  const nowIso = new Date(now).toISOString();
  const { results } = await db
    .prepare(
      `SELECT r.broadcast_id, r.user_id FROM broadcast_receipts r JOIN broadcasts b ON b.id = r.broadcast_id
        WHERE b.event_id = ? AND r.response = 'snoozed' AND r.snooze_until <= ?`,
    )
    .bind(eventId, nowIso)
    .all<{ broadcast_id: string; user_id: string }>();
  if (results.length) {
    await db.batch(
      results.map((r) =>
        db
          .prepare("UPDATE broadcast_receipts SET response = 'none', snooze_until = NULL, delivered_at = ? WHERE broadcast_id = ? AND user_id = ?")
          .bind(nowIso, r.broadcast_id, r.user_id),
      ),
    );
  }
  return results.map((r) => ({ userId: r.user_id, broadcastId: r.broadcast_id }));
}

/** When the next snoozed alert is due back, if any. */
export async function nextSnoozeAt(db: D1Database, eventId: string): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT MIN(r.snooze_until) AS next FROM broadcast_receipts r JOIN broadcasts b ON b.id = r.broadcast_id
        WHERE b.event_id = ? AND r.response = 'snoozed'`,
    )
    .bind(eventId)
    .first<{ next: string | null }>();
  return row?.next ? Date.parse(row.next) : null;
}

/**
 * The lock-screen card during a live event: an iOS Live Activity or an Android Live Update.
 *
 * Everyone with a part on the program gets one when the event goes live. It shows the
 * latest broadcast they received, and switches to "You're up next" / "You're on now"
 * around their part. It closes when the event ends.
 *
 * After every change in the live room, syncLiveCards works out each person's card and
 * only pushes the ones that changed (iOS rations Live Activity updates per phone).
 */
import { sendLiveActivityPushes, type LiveActivityPush } from "../apns";
import type { Env } from "../env";
import { pushLiveData } from "../push";

/** Must match the name the app gives createLiveActivity. */
export const ACTIVITY_NAME = "QronoLive";

export interface LiveCard {
  eventId: string;
  eventName: string;
  /** "You're on now", "You're up next", or "Live now". */
  headline: string;
  /** Your part's title, when it's on now or next. */
  detail: string | null;
  /** On now or up next: the card turns purple and alerts. */
  urgent: boolean;
  /** "Ada Obi: Please take your seats", the latest broadcast you received. */
  broadcast: string | null;
  broadcastAt: string | null;
}

type CardEnv = Pick<Env, "DB" | "EXPO_ACCESS_TOKEN" | "APNS_KEY" | "APNS_KEY_ID" | "APNS_TEAM_ID" | "APNS_HOST">;

interface EventRow {
  id: string;
  name: string;
  status: string;
  current_task_id: string | null;
  end_at: string;
}

/** Each person on the program (registered users only), with their card as it should look now. */
export async function liveCards(db: D1Database, eventId: string, onlyUserId?: string): Promise<{ event: EventRow; cards: Map<string, LiveCard> } | null> {
  const event = await db.prepare("SELECT id, name, status, current_task_id, end_at FROM events WHERE id = ?").bind(eventId).first<EventRow>();
  if (!event) return null;

  const { results: people } = await db
    .prepare(`SELECT DISTINCT user_id FROM event_participants WHERE event_id = ? AND user_id IS NOT NULL ${onlyUserId ? "AND user_id = ?" : ""}`)
    .bind(...(onlyUserId ? [eventId, onlyUserId] : [eventId]))
    .all<{ user_id: string }>();
  const { results: tasks } = await db
    .prepare("SELECT id, title, status FROM tasks WHERE event_id = ? ORDER BY sort_order, created_at")
    .bind(eventId)
    .all<{ id: string; title: string; status: string }>();
  const { results: parts } = await db
    .prepare(
      `SELECT a.task_id, p.user_id FROM task_assignments a JOIN event_participants p ON p.id = a.participant_id
        WHERE p.event_id = ? AND p.user_id IS NOT NULL`,
    )
    .bind(eventId)
    .all<{ task_id: string; user_id: string }>();
  const { results: latest } = await db
    .prepare(
      `SELECT r.user_id, b.body, b.sent_at, u.first_name || ' ' || u.last_name AS sent_by
         FROM broadcast_receipts r JOIN broadcasts b ON b.id = r.broadcast_id JOIN users u ON u.id = b.sent_by
        WHERE b.event_id = ? ORDER BY b.sent_at`,
    )
    .bind(eventId)
    .all<{ user_id: string; body: string; sent_at: string; sent_by: string }>();

  const current = tasks.find((t) => t.id === event.current_task_id && t.status === "in_progress") ?? null;
  const next = tasks.find((t) => t.status === "upcoming") ?? null;
  const on = (task: { id: string } | null, userId: string) => !!task && parts.some((p) => p.task_id === task.id && p.user_id === userId);
  const lastBroadcast = new Map(latest.map((b) => [b.user_id, b])); // ordered by time, so the last one wins

  const cards = new Map<string, LiveCard>();
  for (const { user_id: userId } of people) {
    const b = lastBroadcast.get(userId);
    const mode = on(current, userId) ? "now" : on(next, userId) ? "next" : null;
    cards.set(userId, {
      eventId,
      eventName: event.name,
      headline: mode === "now" ? "You're on now" : mode === "next" ? "You're up next" : "Live now",
      detail: mode === "now" ? current!.title : mode === "next" ? next!.title : null,
      urgent: mode !== null,
      broadcast: b ? `${b.sent_by}: ${b.body}` : null,
      broadcastAt: b?.sent_at ?? null,
    });
  }
  return { event, cards };
}

/** The props the iOS layout reads. Kept small: an ActivityKit payload is capped at 4 KB. */
const props = (card: LiveCard) =>
  JSON.stringify({ ...card, broadcast: card.broadcast && card.broadcast.length > 300 ? `${card.broadcast.slice(0, 297)}…` : card.broadcast });

/** What, if anything, a change should pop up as an alert. */
function alertFor(card: LiveCard, before: LiveCard | null): { title: string; body: string } | null {
  if (!before) return { title: `${card.eventName} is live`, body: card.urgent ? `${card.headline}: ${card.detail}` : "Updates will show here." };
  if (card.urgent && (card.headline !== before.headline || card.detail !== before.detail)) return { title: card.headline, body: card.detail ?? card.eventName };
  if (card.broadcastAt && card.broadcastAt !== before.broadcastAt) return { title: card.eventName, body: card.broadcast ?? "" };
  return null;
}

/**
 * Brings every phone's card in line with the room: opens cards when the event goes
 * live, updates the ones that changed, closes them when it ends.
 */
export async function syncLiveCards(env: CardEnv, eventId: string, now = Date.now(), fetcher: typeof fetch = fetch): Promise<{ ios: number; android: number }> {
  const db = env.DB;
  const found = await liveCards(db, eventId);
  if (!found) return { ios: 0, android: 0 };
  const { event, cards } = found;
  const at = new Date(now).toISOString();
  const ts = Math.floor(now / 1000);

  const { results: rows } = await db
    .prepare("SELECT user_id, state, ended_at FROM live_cards WHERE event_id = ?")
    .bind(eventId)
    .all<{ user_id: string; state: string; ended_at: string | null }>();
  const sent = new Map(rows.map((r) => [r.user_id, r]));

  const ios: LiveActivityPush[] = [];
  const android: { userId: string; data: Record<string, string> }[] = [];
  const writes: D1PreparedStatement[] = [];

  const tokens = async (userIds: string[], kind: "start" | "activity") => {
    if (userIds.length === 0) return [] as { user_id: string; token: string }[];
    const { results } = await db
      .prepare(
        `SELECT user_id, token FROM live_activity_tokens WHERE kind = ? ${kind === "activity" ? "AND event_id = ?" : ""}
          AND user_id IN (${userIds.map(() => "?").join(",")})`,
      )
      .bind(...(kind === "activity" ? [kind, eventId] : [kind]), ...userIds)
      .all<{ user_id: string; token: string }>();
    return results;
  };

  if (event.status === "live") {
    const changed: { userId: string; card: LiveCard; before: LiveCard | null }[] = [];
    for (const [userId, card] of cards) {
      const row = sent.get(userId);
      if (row && !row.ended_at && row.state === JSON.stringify(card)) continue;
      changed.push({ userId, card, before: row && !row.ended_at ? (JSON.parse(row.state) as LiveCard) : null });
    }
    const starting = changed.filter((c) => !c.before).map((c) => c.userId);
    const startTokens = await tokens(starting, "start");
    const activityTokens = await tokens(
      changed.map((c) => c.userId),
      "activity",
    );
    // The card goes stale (greyed) if nothing is heard by the scheduled end plus an hour.
    const stale = Math.floor(Math.max(Date.parse(event.end_at), now) / 1000) + 3600;

    for (const { userId, card, before } of changed) {
      const alert = alertFor(card, before);
      const state = { name: ACTIVITY_NAME, props: props(card) };
      const mine = activityTokens.filter((t) => t.user_id === userId);
      if (mine.length) {
        // A card is already open on this phone (started by push or by the app): update it.
        for (const t of mine)
          ios.push({ token: t.token, priority: alert ? 10 : 5, aps: { timestamp: ts, event: "update", "content-state": state, "stale-date": stale, ...(alert ? { alert } : {}) } });
      } else if (!before) {
        for (const t of startTokens.filter((x) => x.user_id === userId))
          ios.push({
            token: t.token,
            priority: 10,
            aps: {
              timestamp: ts,
              event: "start",
              "content-state": state,
              "stale-date": stale,
              "attributes-type": "LiveActivityAttributes",
              attributes: {},
              alert: alert ?? { title: card.eventName, body: card.headline },
              // iOS 18+: hand back a token for this card, so later changes can reach it.
              "input-push-token": 1,
            },
          });
      }
      android.push({ userId, data: { type: "live", eventId, card: JSON.stringify(card), alert: alert ? "1" : "0" } });
      writes.push(
        db
          .prepare(
            `INSERT INTO live_cards (event_id, user_id, state, started_at, updated_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (event_id, user_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at, ended_at = NULL`,
          )
          .bind(eventId, userId, JSON.stringify(card), at, at),
      );
    }
  } else {
    // Not live (ended, or moved back): close any open cards, and take them off the Lock Screen
    // straight away (a dismissal date of now; later would leave an "Ended" card showing until then).
    const open = rows.filter((r) => !r.ended_at).map((r) => r.user_id);
    for (const t of await tokens(open, "activity"))
      ios.push({ token: t.token, priority: 10, aps: { timestamp: ts, event: "end", "content-state": { name: ACTIVITY_NAME, props: endProps(sent.get(t.user_id)!.state) }, "dismissal-date": ts } });
    for (const userId of open) {
      android.push({ userId, data: { type: "live-end", eventId } });
      writes.push(db.prepare("UPDATE live_cards SET ended_at = ? WHERE event_id = ? AND user_id = ?").bind(at, eventId, userId));
    }
    if (open.length) writes.push(db.prepare("DELETE FROM live_activity_tokens WHERE event_id = ?").bind(eventId));
  }

  if (writes.length) await db.batch(writes);
  const [iosResult, androidSent] = await Promise.all([sendLiveActivityPushes(env, ios, fetcher), pushLiveData(env, android, fetcher)]);
  if (iosResult.dead.length) {
    await db.prepare(`DELETE FROM live_activity_tokens WHERE token IN (${iosResult.dead.map(() => "?").join(",")})`).bind(...iosResult.dead).run();
  }
  return { ios: iosResult.sent, android: androidSent };
}

/** The final card: says it's over, keeps the last broadcast. */
function endProps(state: string): string {
  const card = JSON.parse(state) as LiveCard;
  return props({ ...card, headline: "Ended", detail: null, urgent: false });
}

/** Saves an iOS token: one that can open cards on this phone, or one for an open card. */
export async function saveLiveActivityToken(db: D1Database, userId: string, token: string, eventId: string | null, id: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO live_activity_tokens (id, user_id, kind, event_id, token) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, kind = excluded.kind, event_id = excluded.event_id`,
    )
    .bind(id, userId, eventId ? "activity" : "start", eventId, token)
    .run();
}

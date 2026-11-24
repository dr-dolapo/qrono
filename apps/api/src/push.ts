/**
 * Push notifications through the Expo Push Service (PRD §1.2), which passes
 * them on to Apple (APNs) and Google (FCM). Used for broadcasts (QR040).
 */
import type { Env } from "./env";
import type { Delivery } from "./live/commands";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** The Expo Push API accepts up to 100 messages per request. */
const BATCH = 100;

/** Expo push tokens look like ExponentPushToken[xxxxxxxx]. */
export const EXPO_TOKEN_PATTERN = /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]{10,200}\]$/;

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: "default";
  priority: "high";
  /** Android: the high-importance channel the app creates for broadcasts. */
  channelId: string;
  /** iOS/Android: shows Acknowledge, Snooze and Done buttons (registered by the app). */
  categoryId?: string;
}

interface PushTicket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

/**
 * Sends each broadcast delivery (new alerts and snooze re-alerts) to the
 * recipient's phones. Tokens Expo reports as no longer registered (app
 * uninstalled, notifications turned off) are removed.
 */
export async function pushBroadcasts(env: Pick<Env, "DB" | "EXPO_ACCESS_TOKEN">, eventId: string, deliveries: Delivery[], fetcher: typeof fetch = fetch): Promise<number> {
  if (deliveries.length === 0) return 0;
  const db = env.DB;
  const event = await db.prepare("SELECT name FROM events WHERE id = ?").bind(eventId).first<{ name: string }>();
  if (!event) return 0;

  const userIds = [...new Set(deliveries.map((d) => d.userId))];
  const { results: tokens } = await db
    .prepare(`SELECT user_id, token FROM device_tokens WHERE user_id IN (${userIds.map(() => "?").join(",")})`)
    .bind(...userIds)
    .all<{ user_id: string; token: string }>();
  if (tokens.length === 0) return 0;

  const messages: PushMessage[] = [];
  for (const d of deliveries) {
    const b = d.message.broadcast;
    for (const t of tokens.filter((x) => x.user_id === d.userId)) {
      messages.push({
        to: t.token,
        title: b.realert ? `Reminder: ${event.name}` : event.name,
        body: `${b.sentBy}: ${b.body}`,
        data: { type: "broadcast", eventId, broadcastId: b.id },
        sound: "default",
        priority: "high",
        channelId: "broadcasts",
        categoryId: "broadcast",
      });
    }
  }

  return sendMessages(env, messages, fetcher);
}


/** Sends push messages through Expo, and forgets tokens Expo says are no longer registered. */
async function sendMessages(env: Pick<Env, "DB" | "EXPO_ACCESS_TOKEN">, messages: PushMessage[], fetcher: typeof fetch): Promise<number> {
  if (messages.length === 0) return 0;
  const db = env.DB;
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  // Only needed if "Enhanced security for push notifications" is turned on for the Expo account.
  if (env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;

  const dead: string[] = [];
  let sent = 0;
  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH);
    try {
      const res = await fetcher(EXPO_PUSH_URL, { method: "POST", headers, body: JSON.stringify(batch) });
      if (!res.ok) {
        console.error("Expo push failed", res.status, await res.text().catch(() => ""));
        continue;
      }
      const { data } = (await res.json()) as { data: PushTicket[] };
      data.forEach((ticket, j) => {
        if (ticket.status === "ok") sent++;
        else if (ticket.details?.error === "DeviceNotRegistered") dead.push(batch[j]!.to);
        else console.error("Expo push ticket error", ticket.message);
      });
    } catch (err) {
      console.error("Expo push request failed", err);
    }
  }
  if (dead.length) {
    await db.prepare(`DELETE FROM device_tokens WHERE token IN (${dead.map(() => "?").join(",")})`).bind(...dead).run();
  }
  return sent;
}

/**
 * A push to each of these people's phones about an Inbox item. Tapping it opens
 * the item in the app's Inbox (the app reads `data.inboxKey`).
 */
export async function pushInbox(
  env: Pick<Env, "DB" | "EXPO_ACCESS_TOKEN">,
  userIds: string[],
  note: { title: string; body: string; inboxKey: string },
  fetcher: typeof fetch = fetch,
): Promise<number> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return 0;
  const { results: tokens } = await env.DB.prepare(`SELECT token FROM device_tokens WHERE user_id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<{ token: string }>();
  return sendMessages(
    env,
    tokens.map((t) => ({
      to: t.token,
      title: note.title,
      body: note.body,
      data: { type: "inbox", inboxKey: note.inboxKey },
      sound: "default",
      priority: "high",
      // Android: the app creates this channel. Older versions fall back to their default channel.
      channelId: "inbox",
    })),
    fetcher,
  );
}

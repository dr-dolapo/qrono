import { api } from "../lib/api";
import { sendOrQueue } from "../lib/outbox";

export type BroadcastReply = "acknowledged" | "snoozed" | "done";

/** A broadcast as a participant sees it (GET /api/events/:id/broadcasts). */
export interface MyBroadcast {
  id: string;
  body: string;
  sentBy: string;
  sentAt: string;
  response: "none" | BroadcastReply;
  snoozeUntil: string | null;
}

/** The alert the live room pushes over the WebSocket (and its snooze re-alert). */
export interface IncomingBroadcast {
  id: string;
  body: string;
  sentBy: string;
  sentAt: string;
  realert: boolean;
}

export async function loadMyBroadcasts(eventId: string): Promise<MyBroadcast[]> {
  const res = await api<{ broadcasts: Partial<MyBroadcast>[] }>(`/events/${encodeURIComponent(eventId)}/broadcasts`);
  // Organisers get the full log with everyone's replies instead; their own alerts still arrive live.
  return res.broadcasts.filter((b): b is MyBroadcast => typeof b.response === "string");
}

/** QR041: Acknowledge, Snooze (back in 3 minutes) or Done. Offline, it's saved and sent later (null). */
export function replyToBroadcast(eventId: string, broadcastId: string, response: BroadcastReply) {
  return sendOrQueue<{ response: BroadcastReply; snoozeUntil: string | null }>(
    `/events/${encodeURIComponent(eventId)}/broadcasts/${encodeURIComponent(broadcastId)}/respond`,
    { response },
    "your reply to a message",
  );
}

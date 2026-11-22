import { broadcastMessage, nextSnoozeAt, recipientIds, releaseDueSnoozes, type BroadcastMessage } from "./broadcasts";
import { flushChanges, notifyDueAt, type NotifyHooks } from "./changes";
import { endEvent, goLive, LiveError, nextTask, snapshot, tick, type LiveSnapshot } from "./engine";

/**
 * - start / next / end: Admin controls.
 * - tick: apply whatever is due (alarm, or after approval).
 * - broadcast: deliver a new broadcast to its recipients.
 * - replied: someone answered a broadcast; refresh Admins' views and re-plan snoozes.
 * - edited: an Admin changed an approved/live event; refresh screens, plan the notices.
 */
export type LiveAction = "tick" | "start" | "next" | "end" | "broadcast" | "replied" | "edited";

export interface LiveCommand {
  action: LiveAction | "arm";
  by: string | null;
  broadcastId?: string;
}

export interface Delivery {
  userId: string;
  message: BroadcastMessage;
}

export interface CommandResult {
  ok: boolean;
  status: number;
  error?: string;
  snapshot?: LiveSnapshot;
  /** When the room must wake up next (alarm), or null for never. */
  wakeAt: number | null;
  /** Broadcast alerts to send to specific people's screens. */
  deliveries: Delivery[];
  /** Tell Approvers'/Admins' screens to refresh their broadcast replies. */
  broadcastsChanged: boolean;
  /** Tell every screen the plan changed, so event pages reload it. */
  planChanged: boolean;
  /** Change notices emailed during this command. */
  noticesSent: number;
}

const earliest = (...times: (number | null)[]) => {
  const real = times.filter((t): t is number => t !== null);
  return real.length ? Math.min(...real) : null;
};

/**
 * Applies one command to an event and works out who to alert and when the
 * room next needs to wake. Used by the LiveEvent Durable Object (and by
 * tests, without one).
 */
export async function runCommand(db: D1Database, eventId: string, cmd: LiveCommand, now: number, hooks?: NotifyHooks): Promise<CommandResult> {
  const deliveries: Delivery[] = [];
  let broadcastsChanged = false;
  const planChanged = cmd.action === "edited";
  let noticesSent = 0;
  try {
    if (cmd.action === "start") await goLive(db, eventId, now, cmd.by);
    if (cmd.action === "next") await nextTask(db, eventId, now);
    if (cmd.action === "end") await endEvent(db, eventId, now, cmd.by);
    if (cmd.action === "broadcast" && cmd.broadcastId) {
      const message = await broadcastMessage(db, cmd.broadcastId);
      if (message) for (const userId of await recipientIds(db, cmd.broadcastId)) deliveries.push({ userId, message });
      broadcastsChanged = true;
    }
    if (cmd.action === "replied") broadcastsChanged = true;

    const wakeTick = await tick(db, eventId, now);

    // Snoozes only matter while the event is live.
    const snap = await snapshot(db, eventId, now);
    let wakeSnooze: number | null = null;
    if (snap.event.status === "live") {
      for (const due of await releaseDueSnoozes(db, eventId, now)) {
        const message = await broadcastMessage(db, due.broadcastId, true);
        if (message) deliveries.push({ userId: due.userId, message });
        broadcastsChanged = true;
      }
      wakeSnooze = await nextSnoozeAt(db, eventId);
    }

    // Batched change notices (2 minutes after the last edit).
    if (hooks) noticesSent = await flushChanges(db, eventId, now, hooks);
    const wakeNotify = await notifyDueAt(db, eventId);

    return {
      ok: true,
      status: 200,
      snapshot: snap,
      wakeAt: earliest(wakeTick, wakeSnooze, wakeNotify),
      deliveries,
      broadcastsChanged,
      planChanged,
      noticesSent,
    };
  } catch (err) {
    if (err instanceof LiveError) {
      return { ok: false, status: err.status, error: err.message, wakeAt: null, deliveries: [], broadcastsChanged: false, planChanged: false, noticesSent: 0 };
    }
    throw err;
  }
}

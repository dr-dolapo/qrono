import { endEvent, goLive, LiveError, nextTask, snapshot, tick, type LiveSnapshot } from "./engine";

export type LiveAction = "arm" | "start" | "next" | "end";

export interface LiveCommand {
  action: LiveAction;
  by: string | null;
}

export interface CommandResult {
  ok: boolean;
  status: number;
  error?: string;
  snapshot?: LiveSnapshot;
  /** When the room must wake up next (alarm), or null for never. */
  wakeAt: number | null;
}

/**
 * Applies one command to an event and works out the next wake-up time.
 * Used by the LiveEvent Durable Object (and by tests, without one).
 */
export async function runCommand(db: D1Database, eventId: string, cmd: LiveCommand, now: number): Promise<CommandResult> {
  try {
    if (cmd.action === "start") await goLive(db, eventId, now, cmd.by);
    if (cmd.action === "next") await nextTask(db, eventId, now);
    if (cmd.action === "end") await endEvent(db, eventId, now, cmd.by);
    const wakeAt = await tick(db, eventId, now);
    return { ok: true, status: 200, snapshot: await snapshot(db, eventId, now), wakeAt };
  } catch (err) {
    if (err instanceof LiveError) return { ok: false, status: err.status, error: err.message, wakeAt: null };
    throw err;
  }
}

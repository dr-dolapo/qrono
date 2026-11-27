/**
 * Who's working on a draft right now, for joint editing: each open screen of an Admin or
 * Planner, and the item they have open (if any). Shown as "Ada is editing" markers.
 */
export interface Attendee {
  userId: string;
  name: string;
  viewer: "manager" | "participant";
  /** The item they have open, or null. */
  taskId: string | null;
}

export interface Editor {
  userId: string;
  name: string;
  /** The item they have open on any of their screens, or null. */
  taskId: string | null;
}

/** One entry per person (they may have the draft open on a phone and a laptop). */
export function editorsOf(attendees: Attendee[]): Editor[] {
  const byUser = new Map<string, Editor>();
  for (const a of attendees) {
    if (a.viewer !== "manager") continue;
    const seen = byUser.get(a.userId);
    if (!seen) byUser.set(a.userId, { userId: a.userId, name: a.name, taskId: a.taskId });
    else if (!seen.taskId && a.taskId) seen.taskId = a.taskId;
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A message from a screen: which item it has open. Anything else is ignored. */
export function parseEditing(message: string): { taskId: string | null } | null {
  try {
    const m = JSON.parse(message) as { type?: unknown; taskId?: unknown };
    if (m.type !== "editing") return null;
    if (m.taskId === null) return { taskId: null };
    return typeof m.taskId === "string" && m.taskId.length <= 64 ? { taskId: m.taskId } : null;
  } catch {
    return null;
  }
}

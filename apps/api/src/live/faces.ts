/**
 * What the coloured "pushdown" at the top of an event screen shows, and what the lock-screen
 * card shows: a caption, a big countdown and a colour.
 *
 *  - Me: the countdown to your own part (green while you're on, red if you run over).
 *  - All: the countdown to the start, then what's left of the item on now.
 *
 * Colours: purple by default, amber in the team's warning window, green while your own part
 * is on, red once something has run over time.
 *
 * The same file lives in apps/api/src/live, apps/web/src and apps/mobile/src/events.
 * Keep the copies identical.
 */
export type Tone = "purple" | "amber" | "green" | "red";

export interface FaceTask {
  id: string;
  title: string;
  durationMinutes: number;
  /** Planned start, from the schedule. */
  plannedStartAt: string;
  status: "upcoming" | "in_progress" | "done" | "skipped";
  actualStartAt: string | null;
}

export interface FaceInput {
  status: "draft" | "review" | "approved" | "live" | "past";
  startAt: string;
  /** In program order. */
  tasks: FaceTask[];
  currentTaskId: string | null;
  /** The viewer's own items. */
  mine: Set<string>;
  /** The team's warning window (the command centre's amber), in ms. */
  warningMs: number;
  now: number;
}

export interface Face {
  tone: Tone;
  /** "Your part · Bible reading", "On now · Praise & worship", "The event starts in". */
  caption: string;
  /** The moment the countdown reaches zero; when `over`, the moment it went over (it counts up). Null: no timer, show `text`. */
  target: number | null;
  over: boolean;
  /** When the span being counted began, for progress bars and rings. */
  from: number | null;
  /** Shown instead of a countdown: "Any moment", "Thank you!", "All items are done". */
  text: string | null;
  /** The wait depends on how long earlier items take. */
  estimated: boolean;
  /** When this face next changes colour or wording on its own (to schedule lock-screen updates). */
  changesAt: number | null;
}

const MINUTE = 60_000;

function running(input: FaceInput): { task: FaceTask; start: number; end: number } | null {
  const task = input.tasks.find((t) => t.id === input.currentTaskId && t.status === "in_progress");
  if (!task || !task.actualStartAt) return null;
  const start = Date.parse(task.actualStartAt);
  return { task, start, end: start + task.durationMinutes * MINUTE };
}

/** A countdown to `target`: purple, then amber inside the warning window. */
function countingDown(caption: string, target: number, from: number | null, input: FaceInput, estimated = false): Face {
  const left = target - input.now;
  if (left <= 0) return { tone: "amber", caption, target: null, over: false, from: null, text: "Any moment", estimated, changesAt: null };
  const warn = left <= input.warningMs;
  return { tone: warn ? "amber" : "purple", caption, target, over: false, from, text: null, estimated, changesAt: warn ? null : target - input.warningMs };
}

/** The item on now, counting down to its end (and up once it's over). */
function itemOnNow(r: { task: FaceTask; start: number; end: number }, input: FaceInput): Face {
  const mine = input.mine.has(r.task.id);
  if (input.now >= r.end) {
    return { tone: "red", caption: `Over time · ${r.task.title}`, target: r.end, over: true, from: r.start, text: null, estimated: false, changesAt: null };
  }
  if (mine) {
    return { tone: "green", caption: `You're on now · ${r.task.title}`, target: r.end, over: false, from: r.start, text: null, estimated: false, changesAt: r.end };
  }
  const face = countingDown(`On now · ${r.task.title}`, r.end, r.start, input);
  return { ...face, changesAt: face.changesAt ?? r.end };
}

/** The All tab: the start, then the item on now. */
export function allFace(input: FaceInput): Face {
  if (input.status === "past") return still("This event has ended", "Thank you!");
  if (input.status !== "live") return countingDown("The event starts in", Date.parse(input.startAt), null, input);
  const r = running(input);
  if (r) return itemOnNow(r, input);
  return still("Live now", input.tasks.some((t) => t.status === "upcoming") ? "Next item soon" : "All items are done");
}

/** The Me tab: your own part. Null when you have no part in this program. */
export function meFace(input: FaceInput): Face | null {
  const mineInOrder = input.tasks.filter((t) => input.mine.has(t.id));
  if (mineInOrder.length === 0) return null;
  if (input.status === "past") return still("This event has ended", "Thank you!");

  if (input.status !== "live") {
    const first = mineInOrder[0]!;
    return countingDown(`Your part · ${first.title}`, Date.parse(first.plannedStartAt), null, input);
  }

  const r = running(input);
  if (r && input.mine.has(r.task.id)) return itemOnNow(r, input);

  // Your next part: after what's left of the item on now, and the items in between.
  let at = r ? Math.max(r.end, input.now) : input.now;
  for (const t of input.tasks) {
    if (t.status !== "upcoming") continue;
    if (input.mine.has(t.id)) return countingDown(`Your part · ${t.title}`, at, r?.start ?? null, input, true);
    at += t.durationMinutes * MINUTE;
  }
  return still("Your part is done", "Thank you!");
}

function still(caption: string, text: string): Face {
  return { tone: "purple", caption, target: null, over: false, from: null, text, estimated: false, changesAt: null };
}

/** The big number: "3 days", "5 h 20 min", or "04:09" in the last hour. Over time: "+01:20". */
export function formatFace(face: Face, now: number): string {
  if (face.target === null) return face.text ?? "";
  const ms = face.over ? now - face.target : face.target - now;
  return `${face.over ? "+" : ""}${formatWait(Math.max(0, ms))}`;
}

export function formatWait(ms: number): string {
  if (ms >= 3_600_000) {
    const hours = ms / 3_600_000;
    if (hours >= 48) return `${Math.floor(hours / 24)} days`;
    const h = Math.floor(hours);
    const m = Math.floor((ms % 3_600_000) / MINUTE);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** How far through the span being counted, 0–1 (for bars and rings). */
export function faceProgress(face: Face, now: number): number {
  if (face.target === null || face.from === null || face.over) return face.over ? 1 : 0;
  const span = face.target - face.from;
  return span > 0 ? Math.min(1, Math.max(0, (now - face.from) / span)) : 0;
}

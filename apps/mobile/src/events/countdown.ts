/**
 * What the big countdown shows, for a participant, guest or the team: the time until the event
 * starts, or what's on now and how long it has left. Separately, the countdown to *your* part,
 * unless that's the same thing (your part is first, or on now).
 */
export interface CountdownTask {
  id: string;
  title: string;
  durationMinutes: number;
  /** Planned start, from the schedule. */
  startAt: string;
  /** From the live room, once the event is live. */
  status?: "upcoming" | "in_progress" | "done" | "skipped";
  actualStartAt?: string | null;
}

export interface CountdownInput {
  status: "draft" | "review" | "approved" | "live" | "past";
  startAt: string;
  tasks: CountdownTask[];
  currentTaskId: string | null;
  /** The viewer's own tasks. */
  mine: Set<string>;
  now: number;
}

export type Hero =
  /** Before it starts. `mine`: the first item is theirs, so this is their countdown too. */
  | { kind: "starts"; ms: number; mine: boolean; title: string | null }
  /** Live: what's on and how long is left (negative = over time). */
  | { kind: "now"; ms: number | null; mine: boolean; title: string }
  | { kind: "wrapping-up" }
  | { kind: "ended" };

export type MyPart =
  | { kind: "upcoming"; ms: number; title: string; estimated: boolean }
  | { kind: "done" }
  | null;

export function countdown(input: CountdownInput): { hero: Hero; myPart: MyPart } {
  const { status, tasks, mine, now } = input;
  const myTasks = tasks.filter((t) => mine.has(t.id));

  if (status === "past") return { hero: { kind: "ended" }, myPart: null };

  if (status !== "live") {
    const first = tasks[0];
    const ms = Date.parse(input.startAt) - now;
    if (first && mine.has(first.id)) return { hero: { kind: "starts", ms, mine: true, title: first.title }, myPart: null };
    const next = myTasks[0];
    return {
      hero: { kind: "starts", ms, mine: false, title: null },
      myPart: next ? { kind: "upcoming", ms: Date.parse(next.startAt) - now, title: next.title, estimated: false } : null,
    };
  }

  const current = tasks.find((t) => t.id === input.currentTaskId && t.status === "in_progress") ?? null;
  const remaining = current?.actualStartAt ? current.durationMinutes * 60_000 - (now - Date.parse(current.actualStartAt)) : null;
  const hero: Hero = current ? { kind: "now", ms: remaining, mine: mine.has(current.id), title: current.title } : { kind: "wrapping-up" };
  if (current && mine.has(current.id)) return { hero, myPart: null };

  // My next item: after what's left of this one and the items between.
  let wait = Math.max(0, remaining ?? 0);
  for (const t of tasks) {
    if (t.status !== "upcoming") continue;
    if (mine.has(t.id)) return { hero, myPart: { kind: "upcoming", ms: wait, title: t.title, estimated: true } };
    wait += t.durationMinutes * 60_000;
  }
  return { hero, myPart: myTasks.length ? { kind: "done" } : null };
}

/** Long waits in words ("3 days", "5 h 20 min"); the last hour as a ticking clock. */
export function isLong(ms: number): boolean {
  return ms >= 3_600_000;
}

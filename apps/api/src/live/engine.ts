/**
 * The live-event state machine (PRD §7, §9.5). Pure functions over D1 with
 * an explicit clock, so they can be tested without a Durable Object.
 *
 *  approved ──(start time, or a Planner starts early)──▶ live ──(end time, or End Event)──▶ past
 *
 * While live, exactly one task is "in_progress". Moving on marks it done and
 * starts the next one, recording actual start/end times for the event report.
 *  - manual mode (QR028): a Planner moves on.
 *  - auto mode (QR027): the next task starts when the current one's time is up.
 */

export type LiveStatus = "draft" | "review" | "approved" | "live" | "past";

interface EventRow {
  id: string;
  name: string;
  status: LiveStatus;
  start_at: string;
  end_at: string;
  timezone: string;
  progression_mode: "auto" | "manual";
  current_task_id: string | null;
  ended_early_at: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  duration_minutes: number;
  planned_start_at: string;
  status: "upcoming" | "in_progress" | "done" | "skipped";
  actual_start_at: string | null;
  actual_end_at: string | null;
}

export interface LiveTask {
  id: string;
  title: string;
  durationMinutes: number;
  plannedStartAt: string;
  status: TaskRow["status"];
  actualStartAt: string | null;
  actualEndAt: string | null;
  /** Names in roll-call order. */
  assignees: string[];
}

export interface LiveSnapshot {
  type: "state";
  serverTime: string;
  event: {
    id: string;
    name: string;
    status: LiveStatus;
    startAt: string;
    endAt: string;
    timezone: string;
    progressionMode: "auto" | "manual";
    endedEarlyAt: string | null;
  };
  currentTaskId: string | null;
  tasks: LiveTask[];
}

export class LiveError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

const iso = (ms: number) => new Date(ms).toISOString();

async function loadEvent(db: D1Database, eventId: string): Promise<EventRow> {
  const e = await db
    .prepare("SELECT id, name, status, start_at, end_at, timezone, progression_mode, current_task_id, ended_early_at FROM events WHERE id = ?")
    .bind(eventId)
    .first<EventRow>();
  if (!e) throw new LiveError(404, "Event not found.");
  return e;
}

async function loadTasks(db: D1Database, eventId: string): Promise<TaskRow[]> {
  const { results } = await db
    .prepare(
      "SELECT id, title, duration_minutes, planned_start_at, status, actual_start_at, actual_end_at FROM tasks WHERE event_id = ? ORDER BY sort_order, created_at",
    )
    .bind(eventId)
    .all<TaskRow>();
  return results;
}

function statusChange(db: D1Database, eventId: string, from: LiveStatus, to: LiveStatus, by: string | null, at: number) {
  return db
    .prepare("INSERT INTO event_status_changes (id, event_id, from_status, to_status, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), eventId, from, to, by, iso(at));
}

/** Start the event: it goes live and its first task starts. Allowed early by a Planner. */
export async function goLive(db: D1Database, eventId: string, now: number, by: string | null): Promise<void> {
  const event = await loadEvent(db, eventId);
  if (event.status === "live") return;
  if (event.status !== "approved") throw new LiveError(409, "Only approved events can go live.");
  const tasks = await loadTasks(db, eventId);
  const first = tasks.find((t) => t.status === "upcoming");
  await db.batch([
    db.prepare("UPDATE events SET status = 'live', current_task_id = ?, updated_at = ? WHERE id = ?").bind(first?.id ?? null, iso(now), eventId),
    ...(first ? [db.prepare("UPDATE tasks SET status = 'in_progress', actual_start_at = ? WHERE id = ?").bind(iso(now), first.id)] : []),
    statusChange(db, eventId, "approved", "live", by, now),
  ]);
}

/** Finish the current task and start the next one (QR027 / QR028). */
export async function nextTask(db: D1Database, eventId: string, now: number): Promise<void> {
  const event = await loadEvent(db, eventId);
  if (event.status !== "live") throw new LiveError(409, "The event isn't live.");
  const tasks = await loadTasks(db, eventId);
  const current = tasks.find((t) => t.id === event.current_task_id && t.status === "in_progress");
  const next = tasks.find((t) => t.status === "upcoming");
  if (!current && !next) throw new LiveError(409, "There are no more tasks.");
  await db.batch([
    ...(current ? [db.prepare("UPDATE tasks SET status = 'done', actual_end_at = ? WHERE id = ?").bind(iso(now), current.id)] : []),
    ...(next ? [db.prepare("UPDATE tasks SET status = 'in_progress', actual_start_at = ? WHERE id = ?").bind(iso(now), next.id)] : []),
    db.prepare("UPDATE events SET current_task_id = ?, updated_at = ? WHERE id = ?").bind(next?.id ?? null, iso(now), eventId),
  ]);
}

/** A live event nobody ended closes itself this long after its planned end (or the item on now's end, if later). */
export const FORGOTTEN_AFTER_MS = 3 * 60 * 60_000;

/** Guests' links last as long as the event could: ending it closes them straight away. */
export const guestLinkExpiry = (endAt: string) => new Date(Date.parse(endAt) + FORGOTTEN_AFTER_MS).toISOString();

/** How long after a skip it can still be undone (the app offers 5 seconds; this allows for a slow connection). */
export const UNDO_WINDOW_MS = 30_000;

/**
 * Undo the last skip: the task that just started goes back to upcoming, and the one before it
 * carries on (its time used so far keeps counting). Only straight after the skip.
 */
export async function undoNext(db: D1Database, eventId: string, now: number): Promise<void> {
  const event = await loadEvent(db, eventId);
  if (event.status !== "live") throw new LiveError(409, "The event isn't live.");
  const tasks = await loadTasks(db, eventId);
  const current = tasks.find((t) => t.id === event.current_task_id && t.status === "in_progress");
  if (!current?.actual_start_at) throw new LiveError(409, "There's nothing to undo.");
  const index = tasks.indexOf(current);
  const previous = tasks.slice(0, index).reverse().find((t) => t.status === "done");
  if (!previous || previous.actual_end_at !== current.actual_start_at || now - Date.parse(current.actual_start_at) > UNDO_WINDOW_MS) {
    throw new LiveError(409, "It's too late to undo that.");
  }
  if (event.progression_mode === "auto" && previous.actual_start_at && now >= Date.parse(previous.actual_start_at) + previous.duration_minutes * 60_000) {
    throw new LiveError(409, "This event moves on by itself, and that item's time is up.");
  }
  await db.batch([
    db.prepare("UPDATE tasks SET status = 'upcoming', actual_start_at = NULL WHERE id = ?").bind(current.id),
    db.prepare("UPDATE tasks SET status = 'in_progress', actual_end_at = NULL WHERE id = ?").bind(previous.id),
    db.prepare("UPDATE events SET current_task_id = ?, updated_at = ? WHERE id = ?").bind(previous.id, iso(now), eventId),
  ]);
}

/**
 * End the event (QR029), either by a Planner or because the end time passed.
 * Unfinished tasks are marked skipped; guests' links stop working.
 */
export async function endEvent(db: D1Database, eventId: string, now: number, by: string | null): Promise<void> {
  const event = await loadEvent(db, eventId);
  if (event.status === "past") return;
  if (event.status !== "live" && event.status !== "approved") throw new LiveError(409, "Only live events can be ended.");
  const early = now < Date.parse(event.end_at);
  await db.batch([
    db.prepare("UPDATE tasks SET status = 'done', actual_end_at = ? WHERE event_id = ? AND status = 'in_progress'").bind(iso(now), eventId),
    db.prepare("UPDATE tasks SET status = 'skipped' WHERE event_id = ? AND status = 'upcoming'").bind(eventId),
    db
      .prepare("UPDATE events SET status = 'past', current_task_id = NULL, ended_early_by = ?, ended_early_at = ?, updated_at = ? WHERE id = ?")
      .bind(early ? by : null, early ? iso(now) : null, iso(now), eventId),
    db
      .prepare(
        `UPDATE guest_access_links SET expires_at = ?
          WHERE expires_at > ? AND participant_id IN (SELECT id FROM event_participants WHERE event_id = ?)`,
      )
      .bind(iso(now), iso(now), eventId),
    statusChange(db, eventId, event.status, "past", by, now),
  ]);
}

/**
 * Called by the Durable Object's alarm (and after every change). Applies
 * anything that is due — going live at the start time, auto-advancing,
 * ending once the last item is done (or a forgotten event, hours late) — and
 * returns when it next needs to run.
 */
export async function tick(db: D1Database, eventId: string, now: number): Promise<number | null> {
  for (let guard = 0; guard < 500; guard++) {
    const event = await loadEvent(db, eventId);
    const start = Date.parse(event.start_at);
    const end = Date.parse(event.end_at);

    if (event.status === "approved") {
      if (now >= end) {
        await endEvent(db, eventId, now, null);
        continue;
      }
      if (now >= start) {
        await goLive(db, eventId, start, null);
        continue;
      }
      return start;
    }

    if (event.status === "live") {
      // A live event isn't cut off at its planned end: programs run late. It ends when an Admin
      // or Planner ends it, when its last item is done, or, if it's been forgotten, a while after
      // both the planned end and the item on now's own end have passed.
      const tasks = await loadTasks(db, eventId);
      const current = tasks.find((t) => t.id === event.current_task_id && t.status === "in_progress");
      if (!current && !tasks.some((t) => t.status === "upcoming")) {
        await endEvent(db, eventId, now, null);
        continue;
      }
      const due = current?.actual_start_at ? Date.parse(current.actual_start_at) + current.duration_minutes * 60_000 : null;
      const forgotten = Math.max(end, due ?? end) + FORGOTTEN_AFTER_MS;
      if (now >= forgotten) {
        await endEvent(db, eventId, now, null);
        continue;
      }
      if (event.progression_mode === "auto" && current && due !== null) {
        if (now >= due) {
          // Record the hand-over at the moment it was due, not when we noticed.
          await nextTask(db, eventId, due);
          continue;
        }
        return Math.min(due, forgotten);
      }
      return forgotten;
    }

    return null; // draft, review, past: nothing scheduled
  }
  throw new Error("Live tick did not settle");
}

/** What every connected screen receives. */
export async function snapshot(db: D1Database, eventId: string, now: number): Promise<LiveSnapshot> {
  const event = await loadEvent(db, eventId);
  const tasks = await loadTasks(db, eventId);
  const { results: people } = await db
    .prepare(
      `SELECT a.task_id, COALESCE(u.first_name || ' ' || u.last_name, p.guest_name) AS name
         FROM task_assignments a
         JOIN tasks t ON t.id = a.task_id
         JOIN event_participants p ON p.id = a.participant_id
         LEFT JOIN users u ON u.id = p.user_id
        WHERE t.event_id = ?
        ORDER BY a.roll_call_order`,
    )
    .bind(eventId)
    .all<{ task_id: string; name: string }>();

  return {
    type: "state",
    serverTime: iso(now),
    event: {
      id: event.id,
      name: event.name,
      status: event.status,
      startAt: event.start_at,
      endAt: event.end_at,
      timezone: event.timezone,
      progressionMode: event.progression_mode,
      endedEarlyAt: event.ended_early_at,
    },
    currentTaskId: event.current_task_id,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      durationMinutes: t.duration_minutes,
      plannedStartAt: t.planned_start_at,
      status: t.status,
      actualStartAt: t.actual_start_at,
      actualEndAt: t.actual_end_at,
      assignees: people.filter((p) => p.task_id === t.id).map((p) => p.name),
    })),
  };
}

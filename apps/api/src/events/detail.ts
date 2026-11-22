import type { Context } from "hono";
import type { AppEnv } from "../env";
import type { EventAccess } from "./access";
import { buildSchedule } from "./schedule";

interface StageRow {
  id: string;
  name: string;
  venue: string | null;
  sort_order: number;
}
interface TaskRow {
  id: string;
  stage_id: string | null;
  title: string;
  description: string | null;
  sort_order: number;
  duration_minutes: number;
  status: string;
}
interface ParticipantRow {
  id: string;
  user_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  response: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}
interface AssignmentRow {
  task_id: string;
  participant_id: string;
  roll_call_order: number;
}

async function loadAgenda(c: Context<AppEnv>, eventId: string) {
  const db = c.env.DB;
  const [stages, tasks] = await Promise.all([
    db.prepare("SELECT id, name, venue, sort_order FROM stages WHERE event_id = ? ORDER BY sort_order, created_at").bind(eventId).all<StageRow>(),
    db.prepare(
      "SELECT id, stage_id, title, description, sort_order, duration_minutes, status FROM tasks WHERE event_id = ? ORDER BY sort_order, created_at",
    )
      .bind(eventId)
      .all<TaskRow>(),
  ]);
  return { stages: stages.results, tasks: tasks.results };
}

/**
 * Recomputes every task's planned start time after the agenda or the event
 * times change, and stores it (the live room and reports read it later).
 */
export async function resyncSchedule(c: Context<AppEnv>, eventId: string): Promise<void> {
  const event = await c.env.DB.prepare("SELECT start_at, end_at FROM events WHERE id = ?")
    .bind(eventId)
    .first<{ start_at: string; end_at: string }>();
  if (!event) return;
  const { tasks } = await loadAgenda(c, eventId);
  if (tasks.length === 0) return;
  const schedule = buildSchedule(
    event.start_at,
    event.end_at,
    tasks.map((t) => ({ id: t.id, stageId: t.stage_id, durationMinutes: t.duration_minutes })),
  );
  await c.env.DB.batch(
    schedule.tasks.map((t) => c.env.DB.prepare("UPDATE tasks SET planned_start_at = ? WHERE id = ?").bind(t.startAt, t.id)),
  );
}

/** Everything the event editor and viewers need, with computed times. */
export async function eventDetail(c: Context<AppEnv>, access: EventAccess) {
  const { event } = access;
  const db = c.env.DB;
  const [{ stages, tasks }, participants, assignments] = await Promise.all([
    loadAgenda(c, event.id),
    db.prepare(
      `SELECT p.id, p.user_id, p.guest_name, p.guest_email, p.response,
              u.first_name, u.last_name, u.email
         FROM event_participants p LEFT JOIN users u ON u.id = p.user_id
        WHERE p.event_id = ?
        ORDER BY COALESCE(u.first_name, p.guest_name), p.created_at`,
    )
      .bind(event.id)
      .all<ParticipantRow>(),
    db.prepare(
      `SELECT a.task_id, a.participant_id, a.roll_call_order
         FROM task_assignments a JOIN tasks t ON t.id = a.task_id
        WHERE t.event_id = ?
        ORDER BY a.roll_call_order`,
    )
      .bind(event.id)
      .all<AssignmentRow>(),
  ]);

  const schedule = buildSchedule(
    event.start_at,
    event.end_at,
    tasks.map((t) => ({ id: t.id, stageId: t.stage_id, durationMinutes: t.duration_minutes })),
  );
  const times = new Map(schedule.tasks.map((t) => [t.id, t]));
  const assigneesByTask = new Map<string, string[]>();
  for (const a of assignments.results) {
    assigneesByTask.set(a.task_id, [...(assigneesByTask.get(a.task_id) ?? []), a.participant_id]);
  }

  return {
    event: {
      id: event.id,
      teamId: event.team_id,
      name: event.name,
      description: event.description,
      startAt: event.start_at,
      endAt: event.end_at,
      timezone: event.timezone,
      status: event.status,
      progressionMode: event.progression_mode,
      createdAt: event.created_at,
      updatedAt: event.updated_at,
    },
    permissions: { canEdit: access.canManage && event.status === "draft", canManage: access.canManage },
    stages: stages.map((s) => ({ id: s.id, name: s.name, venue: s.venue })),
    tasks: tasks.map((t) => ({
      id: t.id,
      stageId: t.stage_id,
      title: t.title,
      description: t.description,
      durationMinutes: t.duration_minutes,
      status: t.status,
      startAt: times.get(t.id)!.startAt,
      endAt: times.get(t.id)!.endAt,
      assigneeIds: assigneesByTask.get(t.id) ?? [],
    })),
    participants: participants.results.map((p) => ({
      id: p.id,
      kind: p.user_id ? ("member" as const) : ("guest" as const),
      userId: p.user_id,
      name: p.user_id ? `${p.first_name} ${p.last_name}` : p.guest_name!,
      email: p.user_id ? p.email! : p.guest_email!,
      response: p.response,
    })),
    schedule: { endsAt: schedule.endsAt, overrunMinutes: schedule.overrunMinutes },
  };
}

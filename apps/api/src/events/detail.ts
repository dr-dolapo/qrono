import type { Context } from "hono";
import type { AppEnv } from "../env";
import type { EventAccess } from "./access";
import { loadTeam } from "../teams/settings";
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
  contact_id: string | null;
  response: string;
  decline_reason: string | null;
  responded_at: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}
interface CommentRow {
  id: string;
  task_id: string;
  author_id: string;
  first_name: string;
  last_name: string;
  body: string;
  event_status_at_post: string;
  created_at: string;
}
interface ApproverRow {
  user_id: string;
  first_name: string;
  last_name: string;
  approved_at: string | null;
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
  const db = c.env.DB;
  const event = await db.prepare("SELECT start_at, end_at, status FROM events WHERE id = ?")
    .bind(eventId)
    .first<{ start_at: string; end_at: string; status: string }>();
  if (!event) return;
  const { tasks } = await loadAgenda(c, eventId);
  const schedule = buildSchedule(
    event.start_at,
    event.end_at,
    tasks.map((t) => ({ id: t.id, stageId: t.stage_id, durationMinutes: t.duration_minutes })),
  );
  // An event ends when its agenda does. With nothing on it yet, a minute after it starts.
  const endsAt = tasks.length ? schedule.endsAt : new Date(Date.parse(event.start_at) + 60_000).toISOString();
  const statements = schedule.tasks.map((t) => db.prepare("UPDATE tasks SET planned_start_at = ? WHERE id = ?").bind(t.startAt, t.id));
  if (endsAt !== event.end_at) {
    statements.push(db.prepare("UPDATE events SET end_at = ? WHERE id = ?").bind(endsAt, eventId));
    if (event.status === "approved" || event.status === "live") {
      // Guests' links expire when the event ends.
      statements.push(
        db.prepare(
          `UPDATE guest_access_links SET expires_at = ?
            WHERE revoked_at IS NULL AND participant_id IN (SELECT id FROM event_participants WHERE event_id = ?)`,
        ).bind(endsAt, eventId),
      );
    }
  }
  if (statements.length) await db.batch(statements);
}

/** Everything the event editor and viewers need, with computed times. */
export async function eventDetail(c: Context<AppEnv>, access: EventAccess) {
  const { event } = access;
  const db = c.env.DB;
  const me = c.get("user")!;
  const [{ stages, tasks }, participants, assignments, comments, approvers] = await Promise.all([
    loadAgenda(c, event.id),
    db.prepare(
      `SELECT p.id, p.user_id, p.guest_name, p.guest_email, p.contact_id, p.response, p.decline_reason, p.responded_at,
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
    db.prepare(
      `SELECT c.id, c.task_id, c.author_id, u.first_name, u.last_name, c.body, c.event_status_at_post, c.created_at
         FROM comments c JOIN tasks t ON t.id = c.task_id JOIN users u ON u.id = c.author_id
        WHERE t.event_id = ? AND c.deleted_at IS NULL
        ORDER BY c.created_at`,
    )
      .bind(event.id)
      .all<CommentRow>(),
    db.prepare(
      `SELECT a.user_id, u.first_name, u.last_name, a.approved_at
         FROM event_approvers a JOIN users u ON u.id = a.user_id
        WHERE a.event_id = ? ORDER BY u.first_name`,
    )
      .bind(event.id)
      .all<ApproverRow>(),
  ]);
  const myParticipant = participants.results.find((p) => p.user_id === me.id) ?? null;
  const iAmChosenApprover = approvers.results.some((a) => a.user_id === me.id);
  const team = (await loadTeam(db, event.team_id))!;
  const requireApproval = team.require_approval === 1;
  // Who sent it for review, for the "can't approve your own" rule.
  const submittedBy =
    event.status === "review"
      ? ((
          await db
            .prepare("SELECT changed_by FROM event_status_changes WHERE event_id = ? AND to_status = 'review' ORDER BY changed_at DESC, rowid DESC LIMIT 1")
            .bind(event.id)
            .first<{ changed_by: string | null }>()
        )?.changed_by ?? null)
      : null;
  const selfBlocked = team.allow_self_approval !== 1 && submittedBy === me.id;

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
    /** Team settings that shape how this event is shown and run. */
    team: {
      name: team.name,
      clockFormat: team.clock_format,
      venue: team.default_venue,
      requireApproval,
      allowSelfApproval: team.allow_self_approval === 1,
      liveWarningMinutes: team.live_warning_minutes,
      liveShowNames: team.live_show_names === 1,
      submittedBy,
    },
    permissions: {
      canEdit: access.canManage && (event.status === "draft" || event.status === "approved" || event.status === "live"),
      canManage: access.canManage,
      canSubmit: requireApproval && access.canManage && event.status === "draft" && tasks.length > 0,
      /** When the team doesn't require approval, Approvers and Admins publish drafts directly. */
      canPublish: !requireApproval && access.canManage && event.status === "draft" && tasks.length > 0,
      canWithdraw: access.canManage && event.status === "review",
      canApprove: event.status === "review" && iAmChosenApprover && access.role === "approver" && !selfBlocked,
      canComment: true,
      canRespond: myParticipant !== null && (event.status === "approved" || event.status === "live"),
      canRunLive: access.canManage && (event.status === "approved" || event.status === "live"),
    },
    me: {
      userId: me.id,
      participant: myParticipant
        ? { id: myParticipant.id, response: myParticipant.response, declineReason: myParticipant.decline_reason }
        : null,
    },
    approvers: approvers.results.map((a) => ({ userId: a.user_id, name: `${a.first_name} ${a.last_name}`, approvedAt: a.approved_at })),
    comments: comments.results.map((cm) => ({
      id: cm.id,
      taskId: cm.task_id,
      author: { id: cm.author_id, name: `${cm.first_name} ${cm.last_name}` },
      body: cm.body,
      postedDuring: cm.event_status_at_post,
      createdAt: cm.created_at,
    })),
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
      // A guest without an email yet is stored with an empty one.
      email: p.user_id ? p.email! : p.guest_email || null,
      contactId: p.contact_id,
      response: p.response,
      declineReason: p.decline_reason,
      respondedAt: p.responded_at,
    })),
    schedule: { endsAt: schedule.endsAt, overrunMinutes: schedule.overrunMinutes },
  };
}

import { Hono } from "hono";
import { z } from "zod";
import { requireVerifiedUser } from "../auth/session";
import type { AppEnv } from "../env";
import { fail } from "../errors";
import { isPublished, loadEditableEvent, loadEvent, type EventRow } from "../events/access";
import { eventDetail, resyncSchedule } from "../events/detail";
import { AGENDA_DURATIONS, isAgendaDuration } from "../events/durations";
import { newId, nowIso } from "../ids";
import { markChanged } from "../live/changes";
import { liveCommand } from "./live";
import { MANAGERS, requireMembership } from "../teams/permissions";
import { emailField, json } from "../validation";

// ───────────── Field rules ─────────────

const isoDate = z
  .string({ error: "Choose a date and time." })
  .refine((v) => !Number.isNaN(Date.parse(v)) && /T/.test(v), { error: "Choose a valid date and time." })
  .transform((v) => new Date(v).toISOString());

const timezone = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { error: "Choose a valid time zone." },
);

const eventName = z.string({ error: "Enter a name for the event." }).trim().min(2, { error: "Use at least 2 characters." }).max(120, { error: "Use at most 120 characters." });
const description = z.string().trim().max(2000, { error: "Use at most 2,000 characters." }).nullable().optional();
const progressionMode = z.enum(["auto", "manual"]);

const eventFields = z.object({
  name: eventName,
  description,
  startAt: isoDate,
  endAt: isoDate,
  timezone,
  progressionMode: progressionMode.optional(),
});

const stageFields = z.object({
  name: z.string({ error: "Enter a stage name." }).trim().min(1, { error: "Enter a stage name." }).max(80, { error: "Use at most 80 characters." }),
  venue: z.string().trim().max(120).nullable().optional(),
});

const taskFields = z.object({
  title: z.string({ error: "Enter a title." }).trim().min(1, { error: "Enter a title." }).max(120, { error: "Use at most 120 characters." }),
  description,
  stageId: z.string().nullable().optional(),
  durationMinutes: z
    .number({ error: "Choose a duration." })
    .int({ error: "Choose a duration." })
    .refine(isAgendaDuration, { error: `Choose a duration from the list (${AGENDA_DURATIONS[0]}–${AGENDA_DURATIONS.at(-1)} minutes).` }),
  assigneeIds: z.array(z.string()).max(50).optional(),
  /** Who runs it, from the team's people list. Takes the place of assigneeIds; adds them to the event as needed. */
  who: z
    .array(z.union([z.object({ participantId: z.string() }), z.object({ userId: z.string() }), z.object({ contactId: z.string() })]))
    .min(1, { error: "Choose who runs this." })
    .max(50)
    .optional(),
});

const endAfterStart = (start: string, end: string) => {
  if (Date.parse(end) <= Date.parse(start)) fail(400, "Please check the highlighted fields.", { fields: { endAt: "The end must be after the start." } });
};

// ───────────── Team-level routes: list and create ─────────────

export const teamEvents = new Hono<AppEnv>()
  .use(requireVerifiedUser)

  /** Events for the team: everything for Approvers/Admins, the ones they're in for Members. */
  .get("/:teamId/events", async (c) => {
    const teamId = c.req.param("teamId");
    const me = await requireMembership(c, teamId);
    const canManage = MANAGERS.includes(me.role);
    const { results } = await c.env.DB.prepare(
      `SELECT e.id, e.name, e.start_at, e.end_at, e.timezone, e.status,
              (SELECT COUNT(*) FROM tasks t WHERE t.event_id = e.id) AS task_count,
              (SELECT COUNT(*) FROM event_participants p WHERE p.event_id = e.id) AS participant_count,
              (SELECT COUNT(*) FROM event_participants p
                WHERE p.event_id = e.id AND p.user_id IS NULL AND (p.guest_email IS NULL OR p.guest_email = '')) AS missing_email_count,
              (e.status = 'review' AND EXISTS (
                SELECT 1 FROM event_approvers a WHERE a.event_id = e.id AND a.user_id = ? AND a.approved_at IS NULL)) AS awaiting_me
         FROM events e
        WHERE e.team_id = ?
          AND (? OR EXISTS (SELECT 1 FROM event_participants p WHERE p.event_id = e.id AND p.user_id = ?))
        ORDER BY e.start_at`,
    )
      .bind(me.user_id, teamId, canManage ? 1 : 0, me.user_id)
      .all<{
        id: string;
        name: string;
        start_at: string;
        end_at: string;
        timezone: string;
        status: string;
        task_count: number;
        participant_count: number;
        missing_email_count: number;
        awaiting_me: number;
      }>();
    return c.json({
      canCreate: canManage,
      events: results.map((e) => ({
        id: e.id,
        name: e.name,
        startAt: e.start_at,
        endAt: e.end_at,
        timezone: e.timezone,
        status: e.status,
        taskCount: e.task_count,
        participantCount: e.participant_count,
        // Only managers see who's missing an email; everyone else gets 0.
        missingEmailCount: canManage ? e.missing_email_count : 0,
        awaitingMyApproval: e.awaiting_me === 1,
      })),
    });
  })

  /** QR019 / QR022: create a draft event with its start and end time. */
  .post("/:teamId/events", json(eventFields), async (c) => {
    const teamId = c.req.param("teamId");
    const me = await requireMembership(c, teamId, MANAGERS);
    const body = c.req.valid("json");
    endAfterStart(body.startAt, body.endAt);
    const id = newId();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO events (id, team_id, name, description, start_at, end_at, timezone, progression_mode, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, teamId, body.name, body.description || null, body.startAt, body.endAt, body.timezone, body.progressionMode ?? "manual", me.user_id),
      c.env.DB.prepare("INSERT INTO event_status_changes (id, event_id, from_status, to_status, changed_by) VALUES (?, ?, NULL, 'draft', ?)").bind(
        newId(),
        id,
        me.user_id,
      ),
    ]);
    return c.json({ event: { id } }, 201);
  });

// ───────────── Event-level routes ─────────────

export const events = new Hono<AppEnv>()
  .use(requireVerifiedUser)

  .get("/:eventId", async (c) => {
    const access = await loadEvent(c, c.req.param("eventId"));
    return c.json(await eventDetail(c, access));
  })

  /** QR020: edit a draft event's details. */
  .patch("/:eventId", json(eventFields.partial()), async (c) => {
    const { event } = await loadEditableEvent(c, c.req.param("eventId"));
    const body = c.req.valid("json");
    if (event.status === "live") {
      if (body.startAt && body.startAt !== event.start_at) {
        fail(409, "The event has already started, so its start time can't change.", { fields: { startAt: "The event has already started." } });
      }
      if (body.endAt && Date.parse(body.endAt) <= Date.now()) {
        fail(400, "Please check the highlighted fields.", { fields: { endAt: "That time has already passed." } });
      }
      if (body.timezone && body.timezone !== event.timezone) {
        fail(409, "The event has already started, so its time zone can't change.", { fields: { timezone: "The event has already started." } });
      }
    }
    const next = {
      name: body.name ?? event.name,
      description: body.description === undefined ? event.description : body.description || null,
      startAt: body.startAt ?? event.start_at,
      endAt: body.endAt ?? event.end_at,
      timezone: body.timezone ?? event.timezone,
      progressionMode: body.progressionMode ?? event.progression_mode,
    };
    endAfterStart(next.startAt, next.endAt);
    await c.env.DB.prepare(
      `UPDATE events SET name = ?, description = ?, start_at = ?, end_at = ?, timezone = ?, progression_mode = ?, updated_at = ?
        WHERE id = ?`,
    )
      .bind(next.name, next.description, next.startAt, next.endAt, next.timezone, next.progressionMode, nowIso(), event.id)
      .run();
    await resyncSchedule(c, event.id);
    if (isPublished(event.status) && next.endAt !== event.end_at) {
      // Guests' links expire when the event ends.
      await c.env.DB.prepare(
        `UPDATE guest_access_links SET expires_at = ?
          WHERE revoked_at IS NULL AND participant_id IN (SELECT id FROM event_participants WHERE event_id = ?)`,
      )
        .bind(next.endAt, event.id)
        .run();
    }
    await afterPlanEdit(c, event);
    return c.json(await eventDetail(c, await loadEvent(c, event.id)));
  })

  /** Delete a draft event. */
  .delete("/:eventId", async (c) => {
    const { event } = await loadEditableEvent(c, c.req.param("eventId"));
    if (event.status !== "draft") fail(409, "Only draft events can be deleted. To stop a live event, end it from the command centre.", { code: "event_not_draft" });
    await c.env.DB.prepare("DELETE FROM events WHERE id = ?").bind(event.id).run();
    return c.json({ deleted: true });
  })

  // ── Stages ──

  .post("/:eventId/stages", json(stageFields), async (c) => {
    const { event } = await loadEditableEvent(c, c.req.param("eventId"));
    const { name, venue } = c.req.valid("json");
    const max = await c.env.DB.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM stages WHERE event_id = ?").bind(event.id).first<{ m: number }>();
    await c.env.DB.prepare("INSERT INTO stages (id, event_id, name, venue, sort_order) VALUES (?, ?, ?, ?, ?)")
      .bind(newId(), event.id, name, venue || null, (max?.m ?? -1) + 1)
      .run();
    await afterPlanEdit(c, event);
    return c.json(await eventDetail(c, await loadEvent(c, event.id)), 201);
  })

  .patch("/:eventId/stages/:stageId", json(stageFields.partial()), async (c) => {
    const { event } = await loadEditableEvent(c, c.req.param("eventId"));
    const body = c.req.valid("json");
    const res = await c.env.DB.prepare(
      "UPDATE stages SET name = COALESCE(?, name), venue = CASE WHEN ? THEN ? ELSE venue END, updated_at = ? WHERE id = ? AND event_id = ?",
    )
      .bind(body.name ?? null, body.venue !== undefined ? 1 : 0, body.venue || null, nowIso(), c.req.param("stageId"), event.id)
      .run();
    if (!res.meta.changes) fail(404, "Stage not found.");
    await afterPlanEdit(c, event);
    return c.json(await eventDetail(c, await loadEvent(c, event.id)));
  })

  /** A stage can only be removed once it has no tasks, so nothing is deleted by accident. */
  .delete("/:eventId/stages/:stageId", async (c) => {
    const { event } = await loadEditableEvent(c, c.req.param("eventId"));
    const stageId = c.req.param("stageId");
    const used = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE stage_id = ?").bind(stageId).first<{ n: number }>();
    if (used && used.n > 0) {
      fail(409, `This stage still has ${used.n} task${used.n === 1 ? "" : "s"}. Move or delete them first.`, { code: "stage_in_use" });
    }
    const res = await c.env.DB.prepare("DELETE FROM stages WHERE id = ? AND event_id = ?").bind(stageId, event.id).run();
    if (!res.meta.changes) fail(404, "Stage not found.");
    await afterPlanEdit(c, event);
    return c.json(await eventDetail(c, await loadEvent(c, event.id)));
  })

  // ── Participants (QR021) ──

  /** Add a team member, or a guest (e.g. a speaker without a Qrono account). */
  .post(
    "/:eventId/participants",
    json(
      z.union([
        z.object({ userId: z.string().min(1) }),
        z.object({
          guestName: z.string({ error: "Enter the guest's name." }).trim().min(1, { error: "Enter the guest's name." }).max(120),
          guestEmail: emailField,
        }),
      ], { error: "Choose a team member, or enter a guest's name and email." }),
    ),
    async (c) => {
      const { event } = await loadEditableEvent(c, c.req.param("eventId"));
      const body = c.req.valid("json");
      const id = newId();

      if ("userId" in body) {
        const member = await c.env.DB.prepare("SELECT 1 FROM team_memberships WHERE team_id = ? AND user_id = ? AND status = 'active'")
          .bind(event.team_id, body.userId)
          .first();
        if (!member) fail(400, "That person isn't on this team.");
        const exists = await c.env.DB.prepare("SELECT 1 FROM event_participants WHERE event_id = ? AND user_id = ?").bind(event.id, body.userId).first();
        if (exists) fail(409, "This person is already in the event.");
        await c.env.DB.prepare("INSERT INTO event_participants (id, event_id, user_id) VALUES (?, ?, ?)").bind(id, event.id, body.userId).run();
      } else {
        // A guest who already has an account on this team should be added as that member instead.
        const onTeam = await c.env.DB.prepare(
          `SELECT u.id FROM users u JOIN team_memberships m ON m.user_id = u.id
            WHERE u.email = ? AND m.team_id = ? AND m.status = 'active'`,
        )
          .bind(body.guestEmail, event.team_id)
          .first();
        if (onTeam) fail(409, "This person is on your team. Add them as a team member instead.", { fields: { guestEmail: "This person is on your team. Add them from the team list." } });
        const exists = await c.env.DB.prepare("SELECT 1 FROM event_participants WHERE event_id = ? AND guest_email = ?").bind(event.id, body.guestEmail).first();
        if (exists) fail(409, "This guest is already in the event.", { fields: { guestEmail: "This guest is already in the event." } });
        await c.env.DB.prepare("INSERT INTO event_participants (id, event_id, guest_name, guest_email) VALUES (?, ?, ?, ?)")
          .bind(id, event.id, body.guestName, body.guestEmail)
          .run();
      }
      await afterPlanEdit(c, event);
      return c.json({ participantId: id, ...(await eventDetail(c, await loadEvent(c, event.id))) }, 201);
    },
  )

  /** Take someone out of the event (and off all its tasks). */
  .delete("/:eventId/participants/:participantId", async (c) => {
    const { event } = await loadEditableEvent(c, c.req.param("eventId"));
    const res = await c.env.DB.prepare("DELETE FROM event_participants WHERE id = ? AND event_id = ?").bind(c.req.param("participantId"), event.id).run();
    if (!res.meta.changes) fail(404, "Participant not found.");
    await afterPlanEdit(c, event);
    return c.json(await eventDetail(c, await loadEvent(c, event.id)));
  })

  // ── Tasks ──

  /** Add a task to the end of the agenda. */
  .post("/:eventId/tasks", json(taskFields), async (c) => {
    const { event } = await loadEditableEvent(c, c.req.param("eventId"));
    const body = c.req.valid("json");
    await checkStage(c, event.id, body.stageId ?? null);
    const assignees = body.who ? await resolveWho(c, event, body.who) : await checkAssignees(c, event.id, body.assigneeIds ?? []);
    const max = await c.env.DB.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM tasks WHERE event_id = ?").bind(event.id).first<{ m: number }>();
    const id = newId();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO tasks (id, event_id, stage_id, title, description, sort_order, planned_start_at, duration_minutes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, event.id, body.stageId ?? null, body.title, body.description || null, (max?.m ?? -1) + 1, event.start_at, body.durationMinutes),
      ...assignmentStatements(c, id, assignees),
    ]);
    await resyncSchedule(c, event.id);
    await afterPlanEdit(c, event);
    return c.json({ taskId: id, ...(await eventDetail(c, await loadEvent(c, event.id))) }, 201);
  })

  .patch("/:eventId/tasks/:taskId", json(taskFields.partial()), async (c) => {
    const { event } = await loadEditableEvent(c, c.req.param("eventId"));
    const taskId = c.req.param("taskId");
    const task = await c.env.DB.prepare("SELECT id, status FROM tasks WHERE id = ? AND event_id = ?").bind(taskId, event.id).first<{ id: string; status: string }>();
    if (!task) fail(404, "Task not found.");
    if (task.status === "done" || task.status === "skipped") fail(409, "This task has already happened, so it can't be changed.", { code: "task_finished" });
    const body = c.req.valid("json");
    if (body.stageId !== undefined) await checkStage(c, event.id, body.stageId);

    const statements = [
      c.env.DB.prepare(
        `UPDATE tasks SET
           title = COALESCE(?, title),
           description = CASE WHEN ? THEN ? ELSE description END,
           stage_id = CASE WHEN ? THEN ? ELSE stage_id END,
           duration_minutes = COALESCE(?, duration_minutes),
           updated_at = ?
         WHERE id = ?`,
      ).bind(
        body.title ?? null,
        body.description !== undefined ? 1 : 0,
        body.description || null,
        body.stageId !== undefined ? 1 : 0,
        body.stageId ?? null,
        body.durationMinutes ?? null,
        nowIso(),
        taskId,
      ),
    ];
    if (body.who !== undefined || body.assigneeIds !== undefined) {
      const assignees = body.who ? await resolveWho(c, event, body.who) : await checkAssignees(c, event.id, body.assigneeIds!);
      statements.push(c.env.DB.prepare("DELETE FROM task_assignments WHERE task_id = ?").bind(taskId), ...assignmentStatements(c, taskId, assignees));
    }
    await c.env.DB.batch(statements);
    await resyncSchedule(c, event.id);
    await afterPlanEdit(c, event);
    return c.json(await eventDetail(c, await loadEvent(c, event.id)));
  })

  .delete("/:eventId/tasks/:taskId", async (c) => {
    const { event } = await loadEditableEvent(c, c.req.param("eventId"));
    const res = await c.env.DB.prepare("DELETE FROM tasks WHERE id = ? AND event_id = ? AND status = 'upcoming'").bind(c.req.param("taskId"), event.id).run();
    if (!res.meta.changes) {
      const exists = await c.env.DB.prepare("SELECT 1 FROM tasks WHERE id = ? AND event_id = ?").bind(c.req.param("taskId"), event.id).first();
      if (exists) fail(409, "This task has already started, so it can't be deleted.", { code: "task_started" });
      fail(404, "Task not found.");
    }
    await resyncSchedule(c, event.id);
    await afterPlanEdit(c, event);
    return c.json(await eventDetail(c, await loadEvent(c, event.id)));
  })

  /**
   * Start an empty agenda from a template: a copy of one of the team's previous
   * programs. Copies each item's What and Duration; Who is chosen fresh.
   */
  .post("/:eventId/copy-from", json(z.object({ sourceEventId: z.string().min(1) })), async (c) => {
    const { event } = await loadEditableEvent(c, c.req.param("eventId"));
    const { sourceEventId } = c.req.valid("json");
    const db = c.env.DB;
    const source = await db.prepare("SELECT id, team_id, status FROM events WHERE id = ?").bind(sourceEventId).first<{ id: string; team_id: string; status: string }>();
    // Only the same team's programs: nothing is shared between organisations.
    if (!source || source.team_id !== event.team_id || source.id === event.id) fail(404, "Template not found.");
    const existing = await db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE event_id = ?").bind(event.id).first<{ n: number }>();
    if (existing && existing.n > 0) fail(409, "Templates can only be used on an empty agenda.", { code: "agenda_not_empty" });
    const { results } = await db
      .prepare("SELECT title, description, duration_minutes FROM tasks WHERE event_id = ? ORDER BY sort_order, created_at")
      .bind(source.id)
      .all<{ title: string; description: string | null; duration_minutes: number }>();
    if (results.length === 0) fail(409, "That program has no agenda items to copy.");
    await db.batch(
      results.map((t, i) =>
        db
          .prepare(
            `INSERT INTO tasks (id, event_id, stage_id, title, description, sort_order, planned_start_at, duration_minutes)
             VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
          )
          .bind(newId(), event.id, t.title, t.description, i, event.start_at, t.duration_minutes),
      ),
    );
    await resyncSchedule(c, event.id);
    await afterPlanEdit(c, event);
    return c.json(await eventDetail(c, await loadEvent(c, event.id)), 201);
  })

  /** Reorder the agenda. Send every task ID in the new order. */
  .put("/:eventId/tasks/order", json(z.object({ taskIds: z.array(z.string()).max(500) })), async (c) => {
    const { event } = await loadEditableEvent(c, c.req.param("eventId"));
    const { taskIds } = c.req.valid("json");
    const { results } = await c.env.DB.prepare("SELECT id, status FROM tasks WHERE event_id = ? ORDER BY sort_order, created_at")
      .bind(event.id)
      .all<{ id: string; status: string }>();
    const current = new Set(results.map((r) => r.id));
    // Tasks that have started or finished stay where they are.
    const fixed = results.filter((r) => r.status !== "upcoming").map((r) => r.id);
    if (fixed.some((id, i) => taskIds[i] !== id)) {
      fail(409, "Tasks that have already started can't be moved.", { code: "task_started" });
    }
    if (taskIds.length !== current.size || new Set(taskIds).size !== taskIds.length || taskIds.some((id) => !current.has(id))) {
      fail(400, "The agenda changed while you were editing. Reload and try again.", { code: "order_mismatch" });
    }
    await c.env.DB.batch(taskIds.map((id, i) => c.env.DB.prepare("UPDATE tasks SET sort_order = ? WHERE id = ?").bind(i, id)));
    await resyncSchedule(c, event.id);
    await afterPlanEdit(c, event);
    return c.json(await eventDetail(c, await loadEvent(c, event.id)));
  });

// ───────────── Helpers ─────────────

/**
 * After a change to an approved or live event: refresh every screen now, and
 * email the people affected 2 minutes after the last change (batched).
 */
async function afterPlanEdit(c: Ctx, event: EventRow): Promise<void> {
  if (!isPublished(event.status)) return;
  await markChanged(c.env.DB, event.id);
  await liveCommand(c, event.id, "edited", c.get("user")?.id ?? null);
}

type Ctx = Parameters<typeof loadEvent>[0];

async function checkStage(c: Ctx, eventId: string, stageId: string | null): Promise<void> {
  if (stageId === null) return;
  const stage = await c.env.DB.prepare("SELECT 1 FROM stages WHERE id = ? AND event_id = ?").bind(stageId, eventId).first();
  if (!stage) fail(400, "Please check the highlighted fields.", { fields: { stageId: "Choose a stage from this event." } });
}

/** Assignees must be participants of this event; order is kept as the roll-call order. */
async function checkAssignees(c: Ctx, eventId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => "?").join(",");
  const { results } = await c.env.DB.prepare(`SELECT id FROM event_participants WHERE event_id = ? AND id IN (${placeholders})`)
    .bind(eventId, ...unique)
    .all<{ id: string }>();
  if (results.length !== unique.length) {
    fail(400, "Please check the highlighted fields.", { fields: { assigneeIds: "Only people added to this event can be assigned." } });
  }
  return unique;
}

type WhoRef = { participantId: string } | { userId: string } | { contactId: string };

/**
 * Turns "who" (people from the team's list) into this event's participants, adding
 * them to the event when they aren't on it yet. Order is kept as the roll-call order.
 */
async function resolveWho(c: Ctx, event: EventRow, who: WhoRef[]): Promise<string[]> {
  const db = c.env.DB;
  const ids: string[] = [];
  const bad = (msg: string): never => fail(400, "Please check the highlighted fields.", { fields: { who: msg } });

  const placeForUser = async (userId: string): Promise<string> => {
    const member = await db.prepare("SELECT 1 FROM team_memberships WHERE team_id = ? AND user_id = ? AND status = 'active'").bind(event.team_id, userId).first();
    if (!member) bad("Choose people from your team's list.");
    const existing = await db.prepare("SELECT id FROM event_participants WHERE event_id = ? AND user_id = ?").bind(event.id, userId).first<{ id: string }>();
    if (existing) return existing.id;
    const id = newId();
    await db.prepare("INSERT INTO event_participants (id, event_id, user_id) VALUES (?, ?, ?)").bind(id, event.id, userId).run();
    return id;
  };

  for (const ref of who) {
    if ("participantId" in ref) {
      const p = await db.prepare("SELECT id FROM event_participants WHERE id = ? AND event_id = ?").bind(ref.participantId, event.id).first<{ id: string }>();
      if (!p) bad("Choose people from your team's list.");
      ids.push(p!.id);
    } else if ("userId" in ref) {
      ids.push(await placeForUser(ref.userId));
    } else {
      const contact = await db
        .prepare("SELECT id, name, email FROM team_contacts WHERE id = ? AND team_id = ?")
        .bind(ref.contactId, event.team_id)
        .first<{ id: string; name: string; email: string | null }>();
      if (!contact) bad("Choose people from your team's list.");
      // Already on the team under this email? Use the member.
      if (contact!.email) {
        const member = await db
          .prepare("SELECT u.id FROM team_memberships m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? AND m.status = 'active' AND u.email = ?")
          .bind(event.team_id, contact!.email)
          .first<{ id: string }>();
        if (member) {
          ids.push(await placeForUser(member.id));
          continue;
        }
      }
      // An approved program invites new people straight away, so they need an email first.
      if (isPublished(event.status) && !contact!.email) {
        bad(`Add an email for ${contact!.name} first. This program is already approved, so they're invited straight away.`);
      }
      const existing = await db
        .prepare("SELECT id FROM event_participants WHERE event_id = ? AND (contact_id = ? OR (user_id IS NULL AND ? <> '' AND guest_email = ?))")
        .bind(event.id, contact!.id, contact!.email ?? "", contact!.email ?? "")
        .first<{ id: string }>();
      if (existing) {
        await db.prepare("UPDATE event_participants SET contact_id = ? WHERE id = ?").bind(contact!.id, existing.id).run();
        ids.push(existing.id);
        continue;
      }
      const id = newId();
      await db
        .prepare("INSERT INTO event_participants (id, event_id, guest_name, guest_email, contact_id) VALUES (?, ?, ?, ?, ?)")
        .bind(id, event.id, contact!.name, contact!.email ?? "", contact!.id)
        .run();
      ids.push(id);
    }
  }
  return [...new Set(ids)];
}

function assignmentStatements(c: Ctx, taskId: string, participantIds: string[]) {
  return participantIds.map((pid, i) =>
    c.env.DB.prepare("INSERT INTO task_assignments (task_id, participant_id, roll_call_order) VALUES (?, ?, ?)").bind(taskId, pid, i),
  );
}


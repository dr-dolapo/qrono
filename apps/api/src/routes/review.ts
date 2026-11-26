import { Hono } from "hono";
import { archive } from "../inboxArchive";
import type { Context } from "hono";
import { z } from "zod";
import { currentUser, inBackground, requireVerifiedUser } from "../auth/session";
import type { AppEnv } from "../env";
import { fail } from "../errors";
import { loadEvent, type EventRow, type EventStatus } from "../events/access";
import { eventDetail } from "../events/detail";
import { createGuestLink, writeBaseline } from "../live/changes";
import { contactsMissingEmail, inviteContactsOnProgram, listNames } from "../teams/contacts";
import { newId, nowIso } from "../ids";
import {
  assignedEmail,
  eventApprovedEmail,
  formatClockTime,
  formatEventTime,
  guestInviteEmail,
  reviewRequestedEmail,
  sendEmail,
} from "../mail";
import { notifyNote, notifyWaiting } from "../inbox";
import { emailBrand, loadTeam } from "../teams/settings";
import { json } from "../validation";
import { liveCommand } from "./live";

type Ctx = Context<AppEnv>;

async function logStatus(c: Ctx, eventId: string, from: EventStatus, to: EventStatus, by: string | null) {
  return c.env.DB.prepare("INSERT INTO event_status_changes (id, event_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?, ?)").bind(
    newId(),
    eventId,
    from,
    to,
    by,
  );
}

export const responseBody = z
  .object({
    response: z.enum(["acknowledged", "declined"], { error: "Choose whether you can take part." }),
    reason: z.string().trim().max(500, { error: "Use at most 500 characters." }).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.response === "declined" && (!v.reason || v.reason.length < 3)) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Tell the team why you can't take part." });
    }
  });

/** Review, approval, comments and participant responses for one event. */
export const review = new Hono<AppEnv>()
  .use(requireVerifiedUser)

  /** QR011: send a draft for review to one or more chosen Admins. */
  .post(
    "/:eventId/submit",
    json(z.object({ approverIds: z.array(z.string()).min(1, { error: "Choose at least one Admin." }).max(20) })),
    async (c) => {
      const access = await loadEvent(c, c.req.param("eventId"));
      const { event } = access;
      if (!access.canManage) fail(403, "Only Admins and Planners can send events for review.");
      if (event.status !== "draft") fail(409, "Only draft events can be sent for review.", { code: "event_not_draft" });

      const tasks = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE event_id = ?").bind(event.id).first<{ n: number }>();
      if (!tasks?.n) fail(409, "Add at least one task to the agenda before sending it for review.", { code: "agenda_empty" });
      await requireEmails(c, event.id);

      const ids = [...new Set(c.req.valid("json").approverIds)];
      const team = (await loadTeam(c.env.DB, event.team_id))!;
      if (team.allow_self_approval !== 1 && ids.includes(currentUser(c).id)) {
        fail(400, "Please check the highlighted fields.", {
          fields: { approverIds: "Your team doesn't let people approve programs they sent. Choose another Admin." },
        });
      }
      const { results: approvers } = await c.env.DB.prepare(
        `SELECT u.id, u.first_name, u.email FROM team_memberships m JOIN users u ON u.id = m.user_id
          WHERE m.team_id = ? AND m.role = 'approver' AND m.status = 'active' AND u.id IN (${ids.map(() => "?").join(",")})`,
      )
        .bind(event.team_id, ...ids)
        .all<{ id: string; first_name: string; email: string }>();
      if (approvers.length !== ids.length) {
        fail(400, "Please check the highlighted fields.", { fields: { approverIds: "Choose Admins from this team." } });
      }

      const me = currentUser(c);
      await c.env.DB.batch([
        c.env.DB.prepare("DELETE FROM event_approvers WHERE event_id = ?").bind(event.id),
        ...approvers.map((a) => c.env.DB.prepare("INSERT INTO event_approvers (event_id, user_id) VALUES (?, ?)").bind(event.id, a.id)),
        c.env.DB.prepare("UPDATE events SET status = 'review', updated_at = ? WHERE id = ?").bind(nowIso(), event.id),
        await logStatus(c, event.id, "draft", "review", me.id),
      ]);

      const when = formatEventTime(event.start_at, event.timezone, team.clock_format);
      const link = `${c.env.APP_ORIGIN}/admin/events/${event.id}`;
      for (const a of approvers) {
        inBackground(c, sendEmail(c.env, { to: a.email, ...reviewRequestedEmail(`${me.firstName} ${me.lastName}`, event.name, when, link) }));
      }
      // And a push to their phones, opening the approval in their Inbox.
      inBackground(
        c,
        notifyWaiting(
          c.env,
          approvers.filter((a) => a.id !== me.id).map((a) => a.id),
          { key: `approve:${event.id}`, title: `${event.name} needs your approval`, body: `Sent by ${me.firstName} ${me.lastName}.` },
        ),
      );
      return c.json(await eventDetail(c, await loadEvent(c, event.id)));
    },
  )

  /** Take an event back out of review so its plan can be changed. */
  .post("/:eventId/withdraw", async (c) => {
    const access = await loadEvent(c, c.req.param("eventId"));
    if (!access.canManage) fail(403, "Only Admins and Planners can do that.");
    if (access.event.status !== "review") fail(409, "Only events in review can be moved back to draft.");
    // If someone else sends it back, the person who sent it for review hears about it.
    const sender = await lastSubmitter(c.env.DB, access.event.id);
    const actor = currentUser(c);
    if (sender && sender !== actor.id) {
      inBackground(
        c,
        notifyNote(c.env, [sender], {
          kind: "program_returned",
          teamId: access.event.team_id,
          eventId: access.event.id,
          title: `${access.event.name} was sent back to draft`,
          body: `${actor.firstName} ${actor.lastName} moved it back so the plan can be changed.`,
        }),
      );
    }
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM event_approvers WHERE event_id = ?").bind(access.event.id),
      c.env.DB.prepare("UPDATE events SET status = 'draft', updated_at = ? WHERE id = ?").bind(nowIso(), access.event.id),
      await logStatus(c, access.event.id, "review", "draft", currentUser(c).id),
    ]);
    return c.json(await eventDetail(c, await loadEvent(c, access.event.id)));
  })

  /**
   * QR016: approve. Mandate "any to sign": one of the chosen Admins is enough.
   * Then QR017 (Planners told), QR018/QR032 (team members emailed their part) and
   * QR044 (guests emailed a personal link that expires when the event ends).
   */
  .post("/:eventId/approve", async (c) => {
    const access = await loadEvent(c, c.req.param("eventId"));
    const { event } = access;
    if (event.status !== "review") fail(409, "Only events in review can be approved.");
    const me = currentUser(c);
    const chosen = await c.env.DB.prepare("SELECT 1 FROM event_approvers WHERE event_id = ? AND user_id = ?").bind(event.id, me.id).first();
    if (!chosen || access.role !== "approver") fail(403, "Only the Admins chosen for this event can approve it.");
    const team = (await loadTeam(c.env.DB, event.team_id))!;
    if (team.allow_self_approval !== 1) {
      const sent = await c.env.DB.prepare("SELECT changed_by FROM event_status_changes WHERE event_id = ? AND to_status = 'review' ORDER BY changed_at DESC, rowid DESC LIMIT 1")
        .bind(event.id)
        .first<{ changed_by: string | null }>();
      if (sent?.changed_by === me.id) fail(403, "Your team doesn't let people approve programs they sent. Another Admin needs to approve it.", { code: "self_approval" });
    }
    // Approval sends everyone their invitation, so everyone needs an email by now.
    await requireEmails(c, event.id);

    const now = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE event_approvers SET approved_at = ? WHERE event_id = ? AND user_id = ?").bind(now, event.id, me.id),
      c.env.DB.prepare("UPDATE events SET status = 'approved', updated_at = ? WHERE id = ?").bind(now, event.id),
      await logStatus(c, event.id, "review", "approved", me.id),
    ]);
    await notifyOnApproval(c, event, `${me.firstName} ${me.lastName}`, me.id);
    await archive(c.env.DB, { userId: me.id, key: `approve:${event.id}`, teamId: event.team_id, eventId: event.id, outcome: "approved", title: event.name, detail: "Programme approved" });
    // Wake the live room at the start time.
    await liveCommand(c, event.id, "arm", me.id);
    return c.json(await eventDetail(c, await loadEvent(c, event.id)));
  })

  /**
   * When the team doesn't require approval (a Settings choice), Admins and Planners
   * publish a draft directly. Everything else is as for an approval.
   */
  .post("/:eventId/publish", async (c) => {
    const access = await loadEvent(c, c.req.param("eventId"));
    const { event } = access;
    if (!access.canManage) fail(403, "Only Admins and Planners can publish programs.");
    if (event.status !== "draft") fail(409, "Only draft events can be published.", { code: "event_not_draft" });
    const team = (await loadTeam(c.env.DB, event.team_id))!;
    if (team.require_approval === 1) fail(409, "Your team requires programs to be approved. Send it for review instead.", { code: "approval_required" });
    const tasks = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE event_id = ?").bind(event.id).first<{ n: number }>();
    if (!tasks?.n) fail(409, "Add at least one item to the agenda before publishing it.", { code: "agenda_empty" });
    await requireEmails(c, event.id);

    const me = currentUser(c);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE events SET status = 'approved', updated_at = ? WHERE id = ?").bind(nowIso(), event.id),
      await logStatus(c, event.id, "draft", "approved", me.id),
    ]);
    await notifyOnApproval(c, event, `${me.firstName} ${me.lastName}`, me.id);
    await liveCommand(c, event.id, "arm", me.id);
    return c.json(await eventDetail(c, await loadEvent(c, event.id)));
  })

  // ── Comments (QR012–QR015, QR026, QR031) ──

  /** Anyone who can see the event can comment on its tasks, at any stage. */
  .post("/:eventId/tasks/:taskId/comments", json(z.object({ body: z.string().trim().min(1, { error: "Write a comment." }).max(2000) })), async (c) => {
    const { event } = await loadEvent(c, c.req.param("eventId"));
    const task = await c.env.DB.prepare("SELECT 1 FROM tasks WHERE id = ? AND event_id = ?").bind(c.req.param("taskId"), event.id).first();
    if (!task) fail(404, "Task not found.");
    const author = currentUser(c);
    const body = c.req.valid("json").body;
    await c.env.DB.prepare("INSERT INTO comments (id, task_id, author_id, body, event_status_at_post) VALUES (?, ?, ?, ?, ?)")
      .bind(newId(), c.req.param("taskId"), author.id, body, event.status)
      .run();
    // The people on that item hear about it, and so does whoever sent the program for review.
    const { results: onItem } = await c.env.DB.prepare(
      `SELECT p.user_id, t.title FROM task_assignments a JOIN event_participants p ON p.id = a.participant_id JOIN tasks t ON t.id = a.task_id
        WHERE a.task_id = ? AND p.user_id IS NOT NULL`,
    )
      .bind(c.req.param("taskId"))
      .all<{ user_id: string; title: string }>();
    const taskTitle = (await c.env.DB.prepare("SELECT title FROM tasks WHERE id = ?").bind(c.req.param("taskId")).first<{ title: string }>())?.title ?? "an item";
    const sender = event.status === "review" ? await lastSubmitter(c.env.DB, event.id) : null;
    const recipients = [...onItem.map((r) => r.user_id), ...(sender ? [sender] : [])].filter((id) => id !== author.id);
    inBackground(
      c,
      notifyNote(c.env, recipients, {
        kind: "comment",
        teamId: event.team_id,
        eventId: event.id,
        taskId: c.req.param("taskId"),
        title: `${author.firstName} commented on “${taskTitle}”`,
        body: body.length > 140 ? `${body.slice(0, 137)}…` : body,
      }),
    );
    return c.json(await eventDetail(c, await loadEvent(c, event.id)), 201);
  })

  /** Delete your own comment. It's kept in the history as deleted (QR015). */
  .delete("/:eventId/comments/:commentId", async (c) => {
    const { event } = await loadEvent(c, c.req.param("eventId"));
    const res = await c.env.DB.prepare(
      `UPDATE comments SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND author_id = ? AND deleted_at IS NULL
          AND task_id IN (SELECT id FROM tasks WHERE event_id = ?)`,
    )
      .bind(nowIso(), nowIso(), c.req.param("commentId"), currentUser(c).id, event.id)
      .run();
    if (!res.meta.changes) fail(404, "Comment not found.");
    return c.json(await eventDetail(c, await loadEvent(c, event.id)));
  })

  // ── Participant response (QR033–QR035) ──

  .post("/:eventId/response", json(responseBody), async (c) => {
    const { event } = await loadEvent(c, c.req.param("eventId"));
    if (event.status !== "approved" && event.status !== "live") fail(409, "You can respond once the event is approved.");
    const body = c.req.valid("json");
    const res = await c.env.DB.prepare(
      "UPDATE event_participants SET response = ?, decline_reason = ?, responded_at = ?, updated_at = ? WHERE event_id = ? AND user_id = ?",
    )
      .bind(body.response, body.response === "declined" ? body.reason! : null, nowIso(), nowIso(), event.id, currentUser(c).id)
      .run();
    if (!res.meta.changes) fail(403, "You're not on this event's program.");
    const me = currentUser(c);
    const part = await c.env.DB.prepare("SELECT id FROM event_participants WHERE event_id = ? AND user_id = ?").bind(event.id, me.id).first<{ id: string }>();
    if (part) {
      await archive(c.env.DB, {
        userId: me.id,
        key: `confirm:${part.id}`,
        teamId: event.team_id,
        eventId: event.id,
        outcome: body.response === "declined" ? "declined_part" : "confirmed",
        title: event.name,
        detail: body.response === "declined" ? body.reason ?? null : null,
      });
    }
    return c.json(await eventDetail(c, await loadEvent(c, event.id)));
  });

/** Everyone on the program must have an email before it's sent for review or approved. */
async function requireEmails(c: Ctx, eventId: string): Promise<void> {
  const missing = await contactsMissingEmail(c.env.DB, eventId);
  if (missing.length) {
    fail(409, `Add an email for ${listNames(missing)} first. Everyone on the program is invited by email once it's approved.`, {
      code: "missing_emails",
    });
  }
}

/** Emails everyone affected by an approval and creates guests' personal links. */
async function notifyOnApproval(c: Ctx, event: EventRow, approverName: string, approverId: string): Promise<void> {
  const db = c.env.DB;
  const team = (await loadTeam(db, event.team_id))!;
  const when = formatEventTime(event.start_at, event.timezone, team.clock_format);
  const eventLink = `${c.env.APP_ORIGIN}/admin/events/${event.id}`;
  const brand = emailBrand(c.env.APP_ORIGIN, team);

  // QR017: the team's Admins and Planners.
  const { results: managers } = await db
    .prepare(
      `SELECT u.email FROM team_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.team_id = ? AND m.status = 'active' AND m.role IN ('approver', 'admin') AND u.id <> ?`,
    )
    .bind(event.team_id, approverId)
    .all<{ email: string }>();
  for (const m of managers) inBackground(c, sendEmail(c.env, { to: m.email, ...eventApprovedEmail(approverName, event.name, when, eventLink) }));

  // Everyone on the agenda, with their own tasks.
  const { results: participants } = await db
    .prepare(
      `SELECT p.id, p.user_id, p.guest_name, p.guest_email, u.first_name, u.email
         FROM event_participants p LEFT JOIN users u ON u.id = p.user_id
        WHERE p.event_id = ?`,
    )
    .bind(event.id)
    .all<{ id: string; user_id: string | null; guest_name: string | null; guest_email: string | null; first_name: string | null; email: string | null }>();
  const { results: assignments } = await db
    .prepare(
      `SELECT a.participant_id, t.title, t.planned_start_at FROM task_assignments a JOIN tasks t ON t.id = a.task_id
        WHERE t.event_id = ? ORDER BY t.sort_order`,
    )
    .bind(event.id)
    .all<{ participant_id: string; title: string; planned_start_at: string }>();
  const tasksFor = (pid: string) =>
    assignments.filter((a) => a.participant_id === pid).map((a) => `${formatClockTime(a.planned_start_at, event.timezone, team.clock_format)}  ${a.title}`);

  const now = nowIso();
  const writes = [];
  for (const p of participants) {
    if (p.user_id) {
      inBackground(c, sendEmail(c.env, { to: p.email!, ...assignedEmail(p.first_name!, team.name, event.name, when, tasksFor(p.id), eventLink, brand) }));
      // They're attending by default: the Inbox tells them, and they can decline from the event.
      inBackground(
        c,
        notifyNote(c.env, [p.user_id], {
          kind: "part_added",
          teamId: event.team_id,
          eventId: event.id,
          taskId: null,
          title: `You're on the program for ${event.name}`,
          body: tasksFor(p.id)[0] ?? when,
        }),
      );
    } else {
      const token = await createGuestLink(db, p.id, event.end_at);
      const link = `${c.env.APP_ORIGIN}/g/${token}`;
      inBackground(c, sendEmail(c.env, { to: p.guest_email!, ...guestInviteEmail(p.guest_name!, team.name, event.name, when, tasksFor(p.id), link, brand) }));
    }
  }
  // People new to the team are also invited to join it.
  inBackground(
    c,
    inviteContactsOnProgram(db, { appOrigin: c.env.APP_ORIGIN, send: (e) => sendEmail(c.env, e) }, event.id, approverId).catch((err) =>
      console.error("Inviting new people failed", err),
    ),
  );
  writes.push(db.prepare("UPDATE event_participants SET notified_at = ? WHERE event_id = ?").bind(now, event.id));
  await db.batch(writes);
  // Remember what everyone was told, so later changes only notify those affected.
  await writeBaseline(db, event.id);

  // Whoever sent it for review hears it was approved (unless they approved it themselves).
  const sender = await lastSubmitter(db, event.id);
  if (sender && sender !== approverId) {
    inBackground(
      c,
      notifyNote(c.env, [sender], {
        kind: "program_approved",
        teamId: event.team_id,
        eventId: event.id,
        title: `${event.name} was approved`,
        body: `${approverName} approved it. Everyone on the program is being emailed their part.`,
      }),
    );
  }
}

/** Who last sent this program for review, if anyone. */
async function lastSubmitter(db: D1Database, eventId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT changed_by FROM event_status_changes WHERE event_id = ? AND to_status = 'review' ORDER BY changed_at DESC, rowid DESC LIMIT 1")
    .bind(eventId)
    .first<{ changed_by: string | null }>();
  return row?.changed_by ?? null;
}


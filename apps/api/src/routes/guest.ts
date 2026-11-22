import { Hono } from "hono";
import type { Context } from "hono";
import { sha256Hex } from "../auth/crypto";
import type { AppEnv } from "../env";
import { fail } from "../errors";
import { buildSchedule } from "../events/schedule";
import { nowIso } from "../ids";
import { json } from "../validation";
import { responseBody } from "./review";

interface LinkRow {
  link_id: string;
  expires_at: string;
  revoked_at: string | null;
  participant_id: string;
  guest_name: string;
  response: string;
  decline_reason: string | null;
  event_id: string;
  event_name: string;
  description: string | null;
  start_at: string;
  end_at: string;
  timezone: string;
  status: string;
  team_name: string;
}

/** A guest's personal link: valid until the event ends, unless replaced or revoked. */
async function loadLink(c: Context<AppEnv>, token: string): Promise<LinkRow> {
  if (token.length < 20 || token.length > 200) fail(404, "This link isn't valid.", { code: "link_invalid" });
  const row = await c.env.DB.prepare(
    `SELECT l.id AS link_id, l.expires_at, l.revoked_at,
            p.id AS participant_id, p.guest_name, p.response, p.decline_reason,
            e.id AS event_id, e.name AS event_name, e.description, e.start_at, e.end_at, e.timezone, e.status,
            t.name AS team_name
       FROM guest_access_links l
       JOIN event_participants p ON p.id = l.participant_id
       JOIN events e ON e.id = p.event_id
       JOIN teams t ON t.id = e.team_id
      WHERE l.token_hash = ?`,
  )
    .bind(await sha256Hex(token))
    .first<LinkRow>();
  if (!row || row.revoked_at) fail(404, "This link isn't valid any more. Ask the event team for a new one.", { code: "link_invalid" });
  if (row.expires_at <= nowIso()) fail(410, "This event has ended, so this link no longer works.", { code: "link_expired" });
  return row;
}

/**
 * QR044–QR046: what a guest sees from their personal link on a phone browser —
 * no account or app. No broadcasts for guests.
 */
export const guest = new Hono<AppEnv>()
  .get("/:token", async (c) => {
    const link = await loadLink(c, c.req.param("token"));
    const db = c.env.DB;
    const [{ results: tasks }, { results: mine }] = await Promise.all([
      db.prepare("SELECT id, stage_id, title, duration_minutes FROM tasks WHERE event_id = ? ORDER BY sort_order, created_at")
        .bind(link.event_id)
        .all<{ id: string; stage_id: string | null; title: string; duration_minutes: number }>(),
      db.prepare("SELECT task_id FROM task_assignments WHERE participant_id = ?").bind(link.participant_id).all<{ task_id: string }>(),
    ]);
    const myTasks = new Set(mine.map((m) => m.task_id));
    const schedule = buildSchedule(
      link.start_at,
      link.end_at,
      tasks.map((t) => ({ id: t.id, stageId: t.stage_id, durationMinutes: t.duration_minutes })),
    );
    const times = new Map(schedule.tasks.map((t) => [t.id, t]));
    await db.prepare("UPDATE guest_access_links SET last_opened_at = ? WHERE id = ?").bind(nowIso(), link.link_id).run();

    return c.json({
      teamName: link.team_name,
      event: {
        name: link.event_name,
        description: link.description,
        startAt: link.start_at,
        endAt: link.end_at,
        timezone: link.timezone,
        status: link.status,
      },
      me: { name: link.guest_name, response: link.response, declineReason: link.decline_reason },
      program: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        durationMinutes: t.duration_minutes,
        startAt: times.get(t.id)!.startAt,
        endAt: times.get(t.id)!.endAt,
        mine: myTasks.has(t.id),
      })),
    });
  })

  /** QR046: accept or decline from the link. */
  .post("/:token/response", json(responseBody), async (c) => {
    const link = await loadLink(c, c.req.param("token"));
    const body = c.req.valid("json");
    await c.env.DB.prepare("UPDATE event_participants SET response = ?, decline_reason = ?, responded_at = ?, updated_at = ? WHERE id = ?")
      .bind(body.response, body.response === "declined" ? body.reason! : null, nowIso(), nowIso(), link.participant_id)
      .run();
    return c.json({ me: { name: link.guest_name, response: body.response, declineReason: body.response === "declined" ? body.reason : null } });
  });

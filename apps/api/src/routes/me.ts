import { Hono } from "hono";
import { z } from "zod";
import { currentUser, requireVerifiedUser } from "../auth/session";
import type { AppEnv } from "../env";
import { nowIso, newId } from "../ids";
import { EXPO_TOKEN_PATTERN } from "../push";
import { json } from "../validation";

const deviceToken = z.string().regex(EXPO_TOKEN_PATTERN, { error: "That isn't a push token." });

interface MyEventRow {
  id: string;
  team_id: string;
  team_name: string;
  name: string;
  start_at: string;
  end_at: string;
  timezone: string;
  status: string;
  my_response: string | null;
  my_task_count: number;
  next_task_title: string | null;
  next_task_start_at: string | null;
  awaiting_my_approval: number;
}

/** Things about the signed-in user across all their teams. Used by the mobile app. */
export const me = new Hono<AppEnv>()
  .use(requireVerifiedUser)

  /**
   * The events I'm part of in every team I'm active in (QR018, QR023): the ones I'm a participant in,
   * plus events in review where I'm one of the chosen Approvers (QR016). Soonest first.
   */
  .get("/events", async (c) => {
    const user = currentUser(c);
    const { results } = await c.env.DB.prepare(
      `SELECT e.id, e.team_id, t.name AS team_name, e.name, e.start_at, e.end_at, e.timezone, e.status,
              p.response AS my_response,
              (SELECT COUNT(*) FROM task_assignments a JOIN tasks k ON k.id = a.task_id
                WHERE a.participant_id = p.id) AS my_task_count,
              (SELECT k.title FROM task_assignments a JOIN tasks k ON k.id = a.task_id
                WHERE a.participant_id = p.id AND k.status NOT IN ('done', 'skipped')
                ORDER BY k.planned_start_at, k.sort_order LIMIT 1) AS next_task_title,
              (SELECT k.planned_start_at FROM task_assignments a JOIN tasks k ON k.id = a.task_id
                WHERE a.participant_id = p.id AND k.status NOT IN ('done', 'skipped')
                ORDER BY k.planned_start_at, k.sort_order LIMIT 1) AS next_task_start_at,
              (e.status = 'review' AND m.role = 'approver' AND EXISTS (
                 SELECT 1 FROM event_approvers ea WHERE ea.event_id = e.id AND ea.user_id = m.user_id AND ea.approved_at IS NULL
              )) AS awaiting_my_approval
         FROM events e
         JOIN teams t ON t.id = e.team_id
         JOIN team_memberships m ON m.team_id = e.team_id AND m.user_id = ? AND m.status = 'active'
         LEFT JOIN event_participants p ON p.event_id = e.id AND p.user_id = m.user_id
        WHERE p.id IS NOT NULL
           OR (e.status = 'review' AND m.role = 'approver'
               AND EXISTS (SELECT 1 FROM event_approvers ea WHERE ea.event_id = e.id AND ea.user_id = m.user_id))
        ORDER BY e.start_at`,
    )
      .bind(user.id)
      .all<MyEventRow>();

    return c.json({
      events: results.map((e) => ({
        id: e.id,
        team: { id: e.team_id, name: e.team_name },
        name: e.name,
        startAt: e.start_at,
        endAt: e.end_at,
        timezone: e.timezone,
        status: e.status,
        /** null when I'm only here as a chosen Approver. */
        myResponse: e.my_response,
        myTaskCount: e.my_task_count,
        myNextTask: e.next_task_title ? { title: e.next_task_title, startAt: e.next_task_start_at } : null,
        awaitingMyApproval: e.awaiting_my_approval === 1,
      })),
    });
  })

  /**
   * The mobile app registers its push token after login so broadcasts reach this phone (QR040).
   * A token belongs to one phone: if someone else logs in on it, it moves to them.
   */
  .post("/devices", json(z.object({ token: deviceToken, platform: z.enum(["ios", "android"]) })), async (c) => {
    const user = currentUser(c);
    const { token, platform } = c.req.valid("json");
    const now = nowIso();
    await c.env.DB.prepare(
      `INSERT INTO device_tokens (id, user_id, platform, token, last_seen_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform,
                                        last_seen_at = excluded.last_seen_at, updated_at = excluded.last_seen_at`,
    )
      .bind(newId(), user.id, platform, token, now)
      .run();
    return c.json({ registered: true });
  })

  /** Called on log out, so this phone stops getting the user's broadcasts. */
  .post("/devices/unregister", json(z.object({ token: deviceToken })), async (c) => {
    await c.env.DB.prepare("DELETE FROM device_tokens WHERE token = ? AND user_id = ?").bind(c.req.valid("json").token, currentUser(c).id).run();
    return c.json({ unregistered: true });
  });

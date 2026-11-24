import { Hono } from "hono";
import { z } from "zod";
import { currentUser, requireVerifiedUser } from "../auth/session";
import type { AppEnv } from "../env";
import { fail } from "../errors";
import { loadEvent } from "../events/access";
import { newId, nowIso } from "../ids";
import { SNOOZE_MS } from "../live/broadcasts";
import { json } from "../validation";
import { liveCommand } from "./live";

interface ReceiptRow {
  broadcast_id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  response: "none" | "acknowledged" | "snoozed" | "done";
  responded_at: string | null;
  snooze_until: string | null;
  snooze_count: number;
}

/**
 * Broadcasts during a live event (PRD §9.6). Admins and Planners send;
 * registered participants receive and reply. Guests don't get broadcasts.
 */
export const broadcasts = new Hono<AppEnv>()
  .use(requireVerifiedUser)

  /** Admins/Planners: every broadcast with each person's reply (QR042). Participants: theirs. */
  .get("/:eventId/broadcasts", async (c) => {
    const access = await loadEvent(c, c.req.param("eventId"));
    const me = currentUser(c);
    const { results: sent } = await c.env.DB.prepare(
      `SELECT b.id, b.body, b.audience, b.sent_at, u.first_name || ' ' || u.last_name AS sent_by
         FROM broadcasts b JOIN users u ON u.id = b.sent_by
        WHERE b.event_id = ? ORDER BY b.sent_at DESC`,
    )
      .bind(access.event.id)
      .all<{ id: string; body: string; audience: string; sent_at: string; sent_by: string }>();
    const { results: receipts } = await c.env.DB.prepare(
      `SELECT r.broadcast_id, r.user_id, u.first_name, u.last_name, r.response, r.responded_at, r.snooze_until, r.snooze_count
         FROM broadcast_receipts r JOIN broadcasts b ON b.id = r.broadcast_id JOIN users u ON u.id = r.user_id
        WHERE b.event_id = ? ORDER BY u.first_name`,
    )
      .bind(access.event.id)
      .all<ReceiptRow>();

    if (access.canManage) {
      return c.json({
        canSend: access.event.status === "live",
        broadcasts: sent.map((b) => ({
          id: b.id,
          body: b.body,
          audience: b.audience,
          sentBy: b.sent_by,
          sentAt: b.sent_at,
          receipts: receipts
            .filter((r) => r.broadcast_id === b.id)
            .map((r) => ({
              userId: r.user_id,
              name: `${r.first_name} ${r.last_name}`,
              response: r.response,
              respondedAt: r.responded_at,
              snoozeUntil: r.snooze_until,
              snoozeCount: r.snooze_count,
            })),
        })),
      });
    }

    const mine = new Map(receipts.filter((r) => r.user_id === me.id).map((r) => [r.broadcast_id, r]));
    return c.json({
      canSend: false,
      broadcasts: sent
        .filter((b) => mine.has(b.id))
        .map((b) => ({
          id: b.id,
          body: b.body,
          sentBy: b.sent_by,
          sentAt: b.sent_at,
          response: mine.get(b.id)!.response,
          snoozeUntil: mine.get(b.id)!.snooze_until,
        })),
    });
  })

  /** QR038 / QR039: send to everyone on the event, or to selected participants. Live events only. */
  .post(
    "/:eventId/broadcasts",
    json(
      z.object({
        body: z.string({ error: "Write a message." }).trim().min(1, { error: "Write a message." }).max(280, { error: "Keep it to 280 characters." }),
        audience: z.enum(["everyone", "participants"]),
        participantIds: z.array(z.string()).max(200).optional(),
      }),
    ),
    async (c) => {
      const access = await loadEvent(c, c.req.param("eventId"));
      const { event } = access;
      if (!access.canManage) fail(403, "Only Admins and Planners can send broadcasts.");
      if (event.status !== "live") fail(409, "Broadcasts can only be sent while the event is live.", { code: "event_not_live" });
      const me = currentUser(c);
      const body = c.req.valid("json");

      // Registered participants only: guests don't receive broadcasts.
      const { results: participants } = await c.env.DB.prepare(
        "SELECT id, user_id FROM event_participants WHERE event_id = ?",
      )
        .bind(event.id)
        .all<{ id: string; user_id: string | null }>();

      let targets = participants;
      if (body.audience === "participants") {
        const chosen = new Set(body.participantIds ?? []);
        targets = participants.filter((p) => chosen.has(p.id));
        if (chosen.size === 0 || targets.length !== chosen.size) {
          fail(400, "Please check the highlighted fields.", { fields: { participantIds: "Choose people from this event." } });
        }
        if (targets.some((p) => !p.user_id)) {
          fail(400, "Please check the highlighted fields.", { fields: { participantIds: "Guests don't receive broadcasts." } });
        }
      }
      const recipients = [...new Set(targets.map((p) => p.user_id).filter((id): id is string => !!id && id !== me.id))];
      if (recipients.length === 0) fail(409, "There's no one to send this to. Guests don't receive broadcasts.", { code: "no_recipients" });

      const id = newId();
      const now = nowIso();
      await c.env.DB.batch([
        c.env.DB.prepare("INSERT INTO broadcasts (id, event_id, sent_by, body, audience, sent_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
          id,
          event.id,
          me.id,
          body.body,
          body.audience,
          now,
        ),
        ...(body.audience === "participants"
          ? targets.map((p) => c.env.DB.prepare("INSERT INTO broadcast_targets (id, broadcast_id, participant_id) VALUES (?, ?, ?)").bind(newId(), id, p.id))
          : []),
        ...recipients.map((userId) =>
          c.env.DB.prepare("INSERT INTO broadcast_receipts (broadcast_id, user_id, delivered_at) VALUES (?, ?, ?)").bind(id, userId, now),
        ),
      ]);

      await liveCommand(c, event.id, "broadcast", me.id, { broadcastId: id });
      return c.json({ broadcast: { id, recipients: recipients.length } }, 201);
    },
  )

  /** QR041: reply to a broadcast. Snooze brings it back after 3 minutes. */
  .post(
    "/:eventId/broadcasts/:broadcastId/respond",
    json(z.object({ response: z.enum(["acknowledged", "snoozed", "done"], { error: "Choose a reply." }) })),
    async (c) => {
      const { event } = await loadEvent(c, c.req.param("eventId"));
      if (event.status !== "live") fail(409, "This event isn't live any more.");
      const me = currentUser(c);
      const { response } = c.req.valid("json");
      const now = Date.now();
      const snoozeUntil = response === "snoozed" ? new Date(now + SNOOZE_MS).toISOString() : null;

      const res = await c.env.DB.prepare(
        `UPDATE broadcast_receipts
            SET response = ?, responded_at = ?, snooze_until = ?, snooze_count = snooze_count + ?
          WHERE broadcast_id = ? AND user_id = ?
            AND broadcast_id IN (SELECT id FROM broadcasts WHERE event_id = ?)`,
      )
        .bind(response, new Date(now).toISOString(), snoozeUntil, response === "snoozed" ? 1 : 0, c.req.param("broadcastId"), me.id, event.id)
        .run();
      if (!res.meta.changes) fail(404, "Broadcast not found.");

      // Re-plan the room's alarm (for the snooze) and refresh Planners' reply views.
      await liveCommand(c, event.id, "replied", me.id);
      return c.json({ response, snoozeUntil });
    },
  );

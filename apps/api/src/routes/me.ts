import { Hono } from "hono";
import { z } from "zod";
import { currentUser, requireVerifiedUser } from "../auth/session";
import type { AppEnv } from "../env";
import { nowIso, newId } from "../ids";
import { buildInbox, markSeen } from "../inbox";
import { EXPO_TOKEN_PATTERN } from "../push";
import { acceptInvite, findInviteById } from "./invites";
import { liveCards, saveLiveActivityToken } from "../live/cards";
import { ARCHIVE_DAYS, archive, listArchive } from "../inboxArchive";
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
   * plus events in review where I'm one of the chosen Admins (QR016), and, for Admins and Planners,
   * the team's drafts (so everyone building one can find it). Soonest first.
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
           OR (e.status = 'draft' AND m.role IN ('approver', 'admin'))
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
        /** null when I'm only here as a chosen Admin. */
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
  /** The Inbox: what's waiting for me and what's happened, across my teams (mobile). */
  .get("/inbox", async (c) => {
    const user = currentUser(c);
    return c.json(await buildInbox(c.env.DB, { id: user.id, email: user.email }));
  })

  /** Mark items as seen, for the unread count. With no keys, everything in the Inbox now. */
  .post("/inbox/read", json(z.object({ keys: z.array(z.string().max(200)).max(200).optional() })), async (c) => {
    const user = currentUser(c);
    const keys = c.req.valid("json").keys ?? (await buildInbox(c.env.DB, { id: user.id, email: user.email })).items.map((i) => i.key);
    await markSeen(c.env.DB, user.id, keys);
    return c.json(await buildInbox(c.env.DB, { id: user.id, email: user.email }));
  })

  /** A note has been opened or dismissed: it leaves the Inbox for Archived. */
  .post("/inbox/notes/:noteId/done", json(z.object({ action: z.enum(["open", "dismiss"]).optional() }).optional()), async (c) => {
    const user = currentUser(c);
    const id = c.req.param("noteId");
    const res = await c.env.DB.prepare("UPDATE inbox_notes SET done_at = ? WHERE id = ? AND user_id = ? AND done_at IS NULL").bind(nowIso(), id, user.id).run();
    if (res.meta.changes) {
      const note = await c.env.DB.prepare("SELECT team_id, event_id, title, body FROM inbox_notes WHERE id = ?")
        .bind(id)
        .first<{ team_id: string; event_id: string | null; title: string; body: string }>();
      if (note) {
        const opened = c.req.valid("json")?.action === "open";
        await archive(c.env.DB, { userId: user.id, key: `note:${id}`, teamId: note.team_id, eventId: note.event_id, outcome: opened ? "opened" : "dismissed", title: note.title, detail: note.body });
      }
    }
    return c.json(await buildInbox(c.env.DB, { id: user.id, email: user.email }));
  })

  /** Archived: what I've done with Inbox items in the last 60 days. */
  .get("/inbox/archive", async (c) => {
    const user = currentUser(c);
    return c.json({ items: await listArchive(c.env.DB, user.id), keepDays: ARCHIVE_DAYS });
  })

  /** Join a team from an invitation sent to my email (the Inbox's Join button). */
  .post("/invites/:inviteId/accept", async (c) => {
    const invite = await findInviteById(c, c.req.param("inviteId"));
    const res = await acceptInvite(c, invite);
    if (res.ok) {
      await archive(c.env.DB, { userId: currentUser(c).id, key: `invite:${invite.id}`, teamId: invite.team_id, outcome: "joined_team", title: `Joined ${invite.team_name}` });
    }
    return res;
  })

  /** Turn down an invitation sent to my email. */
  .post("/invites/:inviteId/decline", async (c) => {
    const user = currentUser(c);
    await c.env.DB.prepare(
      `UPDATE team_invites SET status = 'revoked', updated_at = ?
        WHERE id = ? AND channel = 'email' AND status = 'pending' AND lower(recipient) = lower(?)`,
    )
      .bind(nowIso(), c.req.param("inviteId"), user.email)
      .run();
    const invite = await c.env.DB.prepare(
      "SELECT i.team_id, t.name FROM team_invites i JOIN teams t ON t.id = i.team_id WHERE i.id = ? AND lower(i.recipient) = lower(?)",
    )
      .bind(c.req.param("inviteId"), user.email)
      .first<{ team_id: string; name: string }>();
    if (invite) {
      await archive(c.env.DB, { userId: user.id, key: `invite:${c.req.param("inviteId")}`, teamId: invite.team_id, outcome: "declined_invite", title: `Declined the invitation to ${invite.name}` });
    }
    return c.json(await buildInbox(c.env.DB, { id: user.id, email: user.email }));
  })

  /** Lock-screen cards for live events I'm on now: the app opens them itself when it can't be pushed. */
  .get("/live-cards", async (c) => {
    const user = currentUser(c);
    const { results } = await c.env.DB.prepare(
      `SELECT DISTINCT e.id FROM events e JOIN event_participants p ON p.event_id = e.id WHERE e.status = 'live' AND p.user_id = ?`,
    )
      .bind(user.id)
      .all<{ id: string }>();
    const cards = [];
    for (const { id } of results) {
      const card = (await liveCards(c.env.DB, id, user.id))?.cards.get(user.id);
      if (card) cards.push(card);
    }
    return c.json({ cards });
  })

  /**
   * iOS Live Activity tokens. kind "start": this phone's push-to-start token (iOS 17.2+).
   * kind "activity": the token of an open card. The app knows the event for cards it opened
   * itself; for cards the server opened, it's the live event this person's card is showing.
   */
  .post(
    "/live-activity-tokens",
    json(
      z.object({
        token: z.string().regex(/^[0-9a-fA-F]{32,400}$/, { error: "That isn't a Live Activity token." }),
        kind: z.enum(["start", "activity"]),
        eventId: z.string().max(64).optional(),
      }),
    ),
    async (c) => {
      const user = currentUser(c);
      const { token, kind } = c.req.valid("json");
      let eventId = kind === "activity" ? c.req.valid("json").eventId : undefined;
      if (kind === "activity") {
        if (eventId) {
          const onIt = await c.env.DB.prepare("SELECT 1 FROM event_participants WHERE event_id = ? AND user_id = ?").bind(eventId, user.id).first();
          if (!onIt) return c.json({ error: "You're not on this event." }, 404);
        } else {
          const open = await c.env.DB.prepare("SELECT event_id FROM live_cards WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1")
            .bind(user.id)
            .first<{ event_id: string }>();
          if (!open) return c.json({ error: "No live event for this card." }, 404);
          eventId = open.event_id;
        }
      }
      await saveLiveActivityToken(c.env.DB, user.id, token.toLowerCase(), eventId ?? null, newId());
      return c.json({ ok: true, eventId: eventId ?? null });
    },
  )

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

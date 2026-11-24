import { Hono } from "hono";
import { z } from "zod";
import { requireVerifiedUser } from "../auth/session";
import type { AppEnv } from "../env";
import { fail } from "../errors";
import { nowIso } from "../ids";
import { MANAGERS, requireMembership } from "../teams/permissions";
import { loadSettings, settingsColumns, settingsPatch } from "../teams/settings";
import { json } from "../validation";

/** Programs that count for the agenda library (the same as for suggestions and templates). */
const APPROVED = "('approved', 'live', 'past')";

/**
 * Settings: the team's (changed by Admins and Planners) and each person's own
 * (reminder emails, which everyone controls for themselves).
 */
export const settings = new Hono<AppEnv>()
  .use(requireVerifiedUser)

  /** Members only get their own settings; Admins and Planners also get the team's. */
  .get("/:teamId/settings", async (c) => {
    const teamId = c.req.param("teamId");
    const me = await requireMembership(c, teamId);
    const canEdit = MANAGERS.includes(me.role);
    const own = await c.env.DB.prepare("SELECT reminder_emails FROM team_memberships WHERE id = ?").bind(me.id).first<{ reminder_emails: number }>();
    const team = await loadSettings(c.env.DB, teamId);
    return c.json({
      canEdit,
      canDeleteTeam: me.role === "approver",
      me: { reminderEmails: own?.reminder_emails !== 0 },
      // Whether reminders are on at all is useful to everyone: it explains their own switch.
      remindersEnabled: team!.remindersEnabled,
      settings: canEdit ? team : null,
    });
  })

  /** Change team settings. Send only the fields that changed. */
  .patch("/:teamId/settings", json(settingsPatch), async (c) => {
    const teamId = c.req.param("teamId");
    await requireMembership(c, teamId, MANAGERS);
    const body = c.req.valid("json");
    const db = c.env.DB;
    const statements: D1PreparedStatement[] = [];

    const cols = settingsColumns(body);
    if (cols.length) {
      statements.push(
        db.prepare(`UPDATE teams SET ${cols.map(([k]) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).bind(...cols.map(([, v]) => v), nowIso(), teamId),
      );
    }
    if (body.defaultApproverIds) {
      const ids = [...new Set(body.defaultApproverIds)];
      if (ids.length) {
        const { results } = await db
          .prepare(
            `SELECT user_id FROM team_memberships
              WHERE team_id = ? AND role = 'approver' AND status = 'active' AND user_id IN (${ids.map(() => "?").join(",")})`,
          )
          .bind(teamId, ...ids)
          .all<{ user_id: string }>();
        if (results.length !== ids.length) fail(400, "Please check the highlighted fields.", { fields: { defaultApproverIds: "Choose Admins from this team." } });
      }
      statements.push(
        db.prepare("DELETE FROM team_default_approvers WHERE team_id = ?").bind(teamId),
        ...ids.map((id) => db.prepare("INSERT INTO team_default_approvers (team_id, user_id) VALUES (?, ?)").bind(teamId, id)),
      );
    }
    // Turning the invite link off also stops the one that's out there.
    if (body.inviteLinkEnabled === false) {
      statements.push(db.prepare("UPDATE team_invites SET status = 'revoked', updated_at = ? WHERE team_id = ? AND channel = 'link' AND status = 'pending'").bind(nowIso(), teamId));
    }
    if (statements.length) await db.batch(statements);
    return c.json({ canEdit: true, settings: await loadSettings(db, teamId) });
  })

  /** Your own settings on this team. Anyone can change their own. */
  .patch("/:teamId/settings/me", json(z.object({ reminderEmails: z.boolean() })), async (c) => {
    const teamId = c.req.param("teamId");
    const me = await requireMembership(c, teamId);
    const { reminderEmails } = c.req.valid("json");
    await c.env.DB.prepare("UPDATE team_memberships SET reminder_emails = ?, updated_at = ? WHERE id = ?").bind(reminderEmails ? 1 : 0, nowIso(), me.id).run();
    return c.json({ me: { reminderEmails } });
  })

  // ── Agenda library ──

  /** Every "What" the team has used on approved programs, and the programs that can be templates. */
  .get("/:teamId/library", async (c) => {
    const teamId = c.req.param("teamId");
    await requireMembership(c, teamId, MANAGERS);
    const db = c.env.DB;
    const [titles, templates] = await Promise.all([
      db
        .prepare(
          `SELECT g.title, g.uses, EXISTS (SELECT 1 FROM hidden_suggestions h WHERE h.team_id = ? AND h.title = g.title) AS hidden
             FROM (SELECT MIN(t.title) AS title, COUNT(*) AS uses
                     FROM tasks t JOIN events e ON e.id = t.event_id
                    WHERE e.team_id = ? AND e.status IN ${APPROVED}
                    GROUP BY lower(t.title)) g
            ORDER BY g.uses DESC, lower(g.title)
            LIMIT 200`,
        )
        .bind(teamId, teamId)
        .all<{ title: string; uses: number; hidden: number }>(),
      db
        .prepare(
          `SELECT e.id, e.name, e.start_at, e.timezone, COUNT(t.id) AS items,
                  EXISTS (SELECT 1 FROM pinned_templates p WHERE p.team_id = e.team_id AND p.event_id = e.id) AS pinned
             FROM events e JOIN tasks t ON t.event_id = e.id
            WHERE e.team_id = ? AND e.status IN ${APPROVED}
            GROUP BY e.id
            ORDER BY pinned DESC, e.start_at DESC
            LIMIT 50`,
        )
        .bind(teamId)
        .all<{ id: string; name: string; start_at: string; timezone: string; items: number; pinned: number }>(),
    ]);
    return c.json({
      suggestions: titles.results.map((r) => ({ title: r.title, uses: r.uses, hidden: r.hidden === 1 })),
      templates: templates.results.map((r) => ({ eventId: r.id, name: r.name, startAt: r.start_at, timezone: r.timezone, items: r.items, pinned: r.pinned === 1 })),
    });
  })

  /** Hide a "What" from suggestions, or bring it back. */
  .put("/:teamId/library/suggestions", json(z.object({ title: z.string().trim().min(1).max(120), hidden: z.boolean() })), async (c) => {
    const teamId = c.req.param("teamId");
    await requireMembership(c, teamId, MANAGERS);
    const { title, hidden } = c.req.valid("json");
    await c.env.DB.prepare(hidden ? "INSERT OR IGNORE INTO hidden_suggestions (team_id, title) VALUES (?, ?)" : "DELETE FROM hidden_suggestions WHERE team_id = ? AND title = ?")
      .bind(teamId, title)
      .run();
    return c.json({ title, hidden });
  })

  /** Pin a program to the top of the template list, or unpin it. */
  .put("/:teamId/library/templates", json(z.object({ eventId: z.string().min(1), pinned: z.boolean() })), async (c) => {
    const teamId = c.req.param("teamId");
    await requireMembership(c, teamId, MANAGERS);
    const { eventId, pinned } = c.req.valid("json");
    const event = await c.env.DB.prepare("SELECT 1 FROM events WHERE id = ? AND team_id = ?").bind(eventId, teamId).first();
    if (!event) fail(404, "Program not found.");
    await c.env.DB.prepare(pinned ? "INSERT OR IGNORE INTO pinned_templates (team_id, event_id) VALUES (?, ?)" : "DELETE FROM pinned_templates WHERE team_id = ? AND event_id = ?")
      .bind(teamId, eventId)
      .run();
    return c.json({ eventId, pinned });
  })

  // ── Danger zone (Admins only) ──

  /** Hand the team to another member: they become an Admin, and you leave. */
  .post("/:teamId/handover", json(z.object({ membershipId: z.string().min(1) })), async (c) => {
    const teamId = c.req.param("teamId");
    const me = await requireMembership(c, teamId, ["approver"]);
    const { membershipId } = c.req.valid("json");
    const target = await c.env.DB.prepare("SELECT id FROM team_memberships WHERE id = ? AND team_id = ? AND status = 'active'")
      .bind(membershipId, teamId)
      .first<{ id: string }>();
    if (!target || target.id === me.id) fail(400, "Please check the highlighted fields.", { fields: { membershipId: "Choose someone else on the team." } });
    const now = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE team_memberships SET role = 'approver', updated_at = ? WHERE id = ?").bind(now, target.id),
      c.env.DB.prepare("UPDATE team_memberships SET status = 'removed', updated_at = ? WHERE id = ?").bind(now, me.id),
    ]);
    return c.json({ left: true });
  })

  /** Delete the team and everything in it. The name must be typed to confirm. */
  .delete("/:teamId", json(z.object({ confirmName: z.string() })), async (c) => {
    const teamId = c.req.param("teamId");
    await requireMembership(c, teamId, ["approver"]);
    const team = await c.env.DB.prepare("SELECT name FROM teams WHERE id = ?").bind(teamId).first<{ name: string }>();
    if (c.req.valid("json").confirmName.trim() !== team!.name) {
      fail(400, "Please check the highlighted fields.", { fields: { confirmName: "Type the team's name exactly as shown." } });
    }
    const live = await c.env.DB.prepare("SELECT 1 FROM events WHERE team_id = ? AND status = 'live'").bind(teamId).first();
    if (live) fail(409, "An event is live right now. End it before deleting the team.", { code: "event_live" });
    await c.env.DB.prepare("DELETE FROM teams WHERE id = ?").bind(teamId).run();
    return c.json({ deleted: true });
  });

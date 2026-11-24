/**
 * What the agenda editor needs from the team: its people list, suggestions from
 * its own approved agendas, and its previous programs to start from.
 * Everything here is scoped to one team: nothing crosses between organisations.
 */
import { Hono } from "hono";
import { z } from "zod";
import { requireVerifiedUser } from "../auth/session";
import type { AppEnv } from "../env";
import { fail } from "../errors";
import { newId, nowIso } from "../ids";
import { linkGuestPlacesToMember, type ContactRow } from "../teams/contacts";
import { MANAGERS, requireMembership } from "../teams/permissions";
import { emailField, json } from "../validation";

/** Events whose agendas count as approved. */
const APPROVED = "('approved', 'live', 'past')";

const personName = z.string({ error: "Enter a name." }).trim().min(1, { error: "Enter a name." }).max(120, { error: "Use at most 120 characters." });
const optionalEmail = z.union([emailField, z.literal("").transform(() => null), z.null()]).optional();

type PersonStatus = "member" | "invited" | "not_invited";

export const planning = new Hono<AppEnv>()
  .use(requireVerifiedUser)

  /**
   * The team's running list of people for "Who": members (joined) and contacts
   * (typed into an agenda; invited, or not invited yet). Admins and Planners only.
   */
  .get("/:teamId/people", async (c) => {
    const teamId = c.req.param("teamId");
    await requireMembership(c, teamId, MANAGERS);
    const db = c.env.DB;
    const [members, contacts, invites] = await Promise.all([
      db
        .prepare(
          `SELECT u.id AS user_id, u.first_name, u.last_name, u.email
             FROM team_memberships m JOIN users u ON u.id = m.user_id
            WHERE m.team_id = ? AND m.status = 'active'
            ORDER BY u.first_name, u.last_name`,
        )
        .bind(teamId)
        .all<{ user_id: string; first_name: string; last_name: string; email: string }>(),
      db.prepare("SELECT id, name, email, invited_at FROM team_contacts WHERE team_id = ? ORDER BY name").bind(teamId).all<ContactRow>(),
      db
        .prepare("SELECT recipient FROM team_invites WHERE team_id = ? AND channel = 'email' AND status = 'pending' AND expires_at > ?")
        .bind(teamId, nowIso())
        .all<{ recipient: string }>(),
    ]);
    const memberEmails = new Set(members.results.map((m) => m.email.toLowerCase()));
    const pending = new Set(invites.results.map((i) => i.recipient.toLowerCase()));

    const people = [
      ...members.results.map((m) => ({
        kind: "member" as const,
        userId: m.user_id,
        name: `${m.first_name} ${m.last_name}`,
        email: m.email,
        status: "member" as PersonStatus,
      })),
      ...contacts.results
        // Contacts who have since joined are listed once, as members.
        .filter((ct) => !ct.email || !memberEmails.has(ct.email.toLowerCase()))
        .map((ct) => ({
          kind: "contact" as const,
          contactId: ct.id,
          name: ct.name,
          email: ct.email,
          status: (ct.email && pending.has(ct.email.toLowerCase()) ? "invited" : "not_invited") as PersonStatus,
        })),
    ].sort((a, b) => a.name.localeCompare(b.name));
    return c.json({ people });
  })

  /** Add someone new to the list, by name (an email can come later). */
  .post("/:teamId/people", json(z.object({ name: personName, email: optionalEmail })), async (c) => {
    const teamId = c.req.param("teamId");
    const me = await requireMembership(c, teamId, MANAGERS);
    const { name, email } = c.req.valid("json");
    const db = c.env.DB;
    if (email) {
      const member = await db
        .prepare(
          `SELECT u.id, u.first_name, u.last_name FROM team_memberships m JOIN users u ON u.id = m.user_id
            WHERE m.team_id = ? AND m.status = 'active' AND u.email = ?`,
        )
        .bind(teamId, email)
        .first<{ id: string; first_name: string; last_name: string }>();
      if (member) {
        return c.json({ person: { kind: "member", userId: member.id, name: `${member.first_name} ${member.last_name}`, email, status: "member" } });
      }
      const existing = await db.prepare("SELECT id, name, email FROM team_contacts WHERE team_id = ? AND email = ?").bind(teamId, email).first<ContactRow>();
      if (existing) return c.json({ person: { kind: "contact", contactId: existing.id, name: existing.name, email: existing.email, status: "not_invited" } });
    }
    const id = newId();
    await db.prepare("INSERT INTO team_contacts (id, team_id, name, email, created_by) VALUES (?, ?, ?, ?, ?)").bind(id, teamId, name, email ?? null, me.user_id).run();
    return c.json({ person: { kind: "contact", contactId: id, name, email: email ?? null, status: "not_invited" } }, 201);
  })

  /**
   * Correct a contact's name or add their email. Their places on upcoming programs
   * follow. If the email turns out to belong to a team member, the contact becomes
   * that member everywhere.
   */
  .patch("/:teamId/people/:contactId", json(z.object({ name: personName.optional(), email: optionalEmail })), async (c) => {
    const teamId = c.req.param("teamId");
    await requireMembership(c, teamId, MANAGERS);
    const db = c.env.DB;
    const contact = await db.prepare("SELECT * FROM team_contacts WHERE id = ? AND team_id = ?").bind(c.req.param("contactId"), teamId).first<ContactRow>();
    if (!contact) fail(404, "Person not found.");
    const body = c.req.valid("json");
    const name = body.name ?? contact.name;
    const email = body.email === undefined ? contact.email : body.email;
    if (contact.email && !email) fail(400, "An email can be changed but not removed.", { fields: { email: "Enter an email." } });

    if (email) {
      const member = await db
        .prepare(
          `SELECT u.id FROM team_memberships m JOIN users u ON u.id = m.user_id
            WHERE m.team_id = ? AND m.status = 'active' AND u.email = ?`,
        )
        .bind(teamId, email)
        .first<{ id: string }>();
      if (member) {
        await db.prepare("UPDATE event_participants SET guest_email = ? WHERE contact_id = ?").bind(email, contact.id).run();
        await linkGuestPlacesToMember(db, teamId, member.id, email);
        await db.prepare("DELETE FROM team_contacts WHERE id = ?").bind(contact.id).run();
        return c.json({ merged: true });
      }
      const clash = await db.prepare("SELECT 1 FROM team_contacts WHERE team_id = ? AND email = ? AND id <> ?").bind(teamId, email, contact.id).first();
      if (clash) fail(409, "Someone else on your list has this email.", { fields: { email: "Someone else on your list has this email." } });
    }
    const now = nowIso();
    await db.batch([
      db.prepare("UPDATE team_contacts SET name = ?, email = ?, updated_at = ? WHERE id = ?").bind(name, email ?? null, now, contact.id),
      // Programs that haven't happened yet pick up the change.
      db
        .prepare(
          `UPDATE event_participants SET guest_name = ?, guest_email = ?, updated_at = ?
            WHERE contact_id = ? AND event_id IN (SELECT id FROM events WHERE status <> 'past')`,
        )
        .bind(name, email ?? "", now, contact.id),
    ]);
    return c.json({ person: { kind: "contact", contactId: contact.id, name, email: email ?? null } });
  })

  /**
   * Suggestions for an agenda item's "What", only from this team's approved agendas:
   * the closest matches first, then the most used.
   */
  .get("/:teamId/agenda-suggestions", async (c) => {
    const teamId = c.req.param("teamId");
    await requireMembership(c, teamId, MANAGERS);
    const q = (c.req.query("q") ?? "").trim().slice(0, 60);
    if (!q) return c.json({ suggestions: [] });
    const like = q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const { results } = await c.env.DB.prepare(
      `SELECT MIN(t.title) AS title, COUNT(*) AS uses, MAX(e.start_at) AS last_used
         FROM tasks t JOIN events e ON e.id = t.event_id
        WHERE e.team_id = ? AND e.status IN ${APPROVED}
          AND t.title LIKE ? ESCAPE '\\'
          AND NOT EXISTS (SELECT 1 FROM hidden_suggestions h WHERE h.team_id = e.team_id AND h.title = t.title)
        GROUP BY lower(t.title)
        ORDER BY lower(MIN(t.title)) LIKE lower(?) ESCAPE '\\' DESC, uses DESC, last_used DESC
        LIMIT 8`,
    )
      .bind(teamId, `%${like}%`, `${like}%`)
      .all<{ title: string; uses: number }>();
    return c.json({ suggestions: results.map((r) => r.title) });
  })

  /** Previous programs to start a new agenda from (approved ones with at least one item). */
  .get("/:teamId/templates", async (c) => {
    const teamId = c.req.param("teamId");
    await requireMembership(c, teamId, MANAGERS);
    const { results } = await c.env.DB.prepare(
      `SELECT e.id, e.name, e.start_at, e.timezone, COUNT(t.id) AS items, SUM(t.duration_minutes) AS minutes,
              (SELECT 1 FROM pinned_templates p WHERE p.team_id = e.team_id AND p.event_id = e.id) AS pinned
         FROM events e JOIN tasks t ON t.event_id = e.id
        WHERE e.team_id = ? AND e.status IN ${APPROVED} AND e.id <> ?
        GROUP BY e.id
        ORDER BY pinned DESC, e.start_at DESC
        LIMIT 30`,
    )
      .bind(teamId, c.req.query("exclude") ?? "")
      .all<{ id: string; name: string; start_at: string; timezone: string; items: number; minutes: number; pinned: number | null }>();
    return c.json({
      templates: results.map((r) => ({
        eventId: r.id,
        name: r.name,
        startAt: r.start_at,
        timezone: r.timezone,
        items: r.items,
        minutes: r.minutes,
        pinned: r.pinned === 1,
      })),
    });
  });

import { Hono } from "hono";
import { z } from "zod";
import { newSecretToken, sha256Hex } from "../auth/crypto";
import { currentUser, inBackground, requireVerifiedUser } from "../auth/session";
import type { AppEnv } from "../env";
import { fail } from "../errors";
import { newId, nowIso } from "../ids";
import { sendEmail, teamInviteEmail } from "../mail";
import { MANAGERS, assertCanManage, requireMembership, type Membership, type Role } from "../teams/permissions";
import { emailField, json, timezoneField } from "../validation";

const EMAIL_INVITE_DAYS = 7;
const LINK_INVITE_DAYS = 30;
const days = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

const roleField = z.enum(["approver", "admin", "member"], { error: "Choose a role." });

export const teams = new Hono<AppEnv>()
  .use(requireVerifiedUser)

  /**
   * QR006: create a team. The creator becomes its first Approver,
   * since an Approver has every Admin right plus approval (PRD §6).
   */
  .post(
    "/",
    json(
      z.object({
        name: z
          .string({ error: "Enter a team name." })
          .trim()
          .min(2, { error: "Use at least 2 characters." })
          .max(80, { error: "Use at most 80 characters." }),
        /** The creator's own time zone; events use it until it's changed in Settings. */
        timezone: timezoneField.optional(),
      }),
    ),
    async (c) => {
      const user = currentUser(c);
      const { name, timezone } = c.req.valid("json");
      const teamId = newId();
      await c.env.DB.batch([
        c.env.DB.prepare("INSERT INTO teams (id, name, created_by, timezone) VALUES (?, ?, ?, ?)").bind(teamId, name, user.id, timezone ?? "UTC"),
        c.env.DB.prepare(
          "INSERT INTO team_memberships (id, team_id, user_id, role, status) VALUES (?, ?, ?, 'approver', 'active')",
        ).bind(newId(), teamId, user.id),
      ]);
      return c.json({ team: { id: teamId, name, role: "approver", status: "active" } }, 201);
    },
  )

  /** QR010: every team the user belongs to (including requests still waiting for approval). */
  .get("/", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT t.id, t.name, t.timezone, t.clock_format AS clockFormat, t.week_start AS weekStart, m.role, m.status
         FROM team_memberships m JOIN teams t ON t.id = m.team_id
        WHERE m.user_id = ? AND m.status <> 'removed'
        ORDER BY t.created_at`,
    )
      .bind(currentUser(c).id)
      .all();
    return c.json({ teams: results });
  })

  // ───────────── Members ─────────────

  /** Everyone on the team. Approvers and Admins also see join requests waiting for approval. */
  .get("/:teamId/members", async (c) => {
    const teamId = c.req.param("teamId");
    const me = await requireMembership(c, teamId);
    const canManage = MANAGERS.includes(me.role);
    const { results } = await c.env.DB.prepare(
      `SELECT m.id, m.role, m.status, m.created_at AS joined_at,
              u.id AS user_id, u.first_name, u.last_name, u.email
         FROM team_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.team_id = ? AND (m.status = 'active' OR (? AND m.status = 'pending_vetting'))
        ORDER BY CASE m.status WHEN 'pending_vetting' THEN 0 ELSE 1 END,
                 CASE m.role WHEN 'approver' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                 u.first_name`,
    )
      .bind(teamId, canManage ? 1 : 0)
      .all<{ id: string; role: Role; status: string; joined_at: string; user_id: string; first_name: string; last_name: string; email: string }>();

    return c.json({
      me: { membershipId: me.id, role: me.role },
      members: results.map((r) => ({
        id: r.id,
        role: r.role,
        status: r.status,
        joinedAt: r.joined_at,
        user: { id: r.user_id, firstName: r.first_name, lastName: r.last_name, email: r.email },
      })),
    });
  })

  /** QR009: change someone's role. */
  .patch("/:teamId/members/:membershipId", json(z.object({ role: roleField })), async (c) => {
    const { teamId, membershipId } = c.req.param();
    const me = await requireMembership(c, teamId, MANAGERS);
    const target = await getMembership(c, teamId, membershipId);
    if (target.status !== "active") fail(409, "Approve this person before changing their role.");
    const { role } = c.req.valid("json");
    if (role === target.role) return c.json({ member: { id: target.id, role } });

    await assertCanManage(c, me, target, { newRole: role });
    await c.env.DB.prepare("UPDATE team_memberships SET role = ?, updated_at = ? WHERE id = ?")
      .bind(role, nowIso(), target.id)
      .run();
    return c.json({ member: { id: target.id, role } });
  })

  /** Vetting: let in someone who joined with the invite link (QR001). */
  .post("/:teamId/members/:membershipId/approve", async (c) => {
    const { teamId, membershipId } = c.req.param();
    const me = await requireMembership(c, teamId, MANAGERS);
    const target = await getMembership(c, teamId, membershipId);
    if (target.status !== "pending_vetting") fail(409, "This person isn't waiting for approval.");
    await c.env.DB.prepare("UPDATE team_memberships SET status = 'active', approved_by = ?, updated_at = ? WHERE id = ?")
      .bind(me.user_id, nowIso(), target.id)
      .run();
    return c.json({ member: { id: target.id, status: "active" } });
  })

  /** Remove someone from the team, decline a join request, or leave the team yourself. */
  .delete("/:teamId/members/:membershipId", async (c) => {
    const { teamId, membershipId } = c.req.param();
    const me = await requireMembership(c, teamId);
    const target = await getMembership(c, teamId, membershipId);
    if (target.status === "removed") fail(404, "Member not found.");
    const self = target.id === me.id;
    if (!self && !MANAGERS.includes(me.role)) fail(403, "You don't have permission to do that on this team.");

    if (self) {
      await assertCanManage(c, { ...me, role: "approver" }, target, { removing: true });
    } else {
      await assertCanManage(c, me, target, { removing: true });
    }
    await c.env.DB.prepare("UPDATE team_memberships SET status = 'removed', updated_at = ? WHERE id = ?")
      .bind(nowIso(), target.id)
      .run();
    return c.json({ member: { id: target.id, status: "removed" } });
  })

  // ───────────── Invites ─────────────

  /** Pending invitations (Approvers and Admins). */
  .get("/:teamId/invites", async (c) => {
    const teamId = c.req.param("teamId");
    await requireMembership(c, teamId, MANAGERS);
    const { results } = await c.env.DB.prepare(
      `SELECT i.id, i.channel, i.recipient, i.role, i.expires_at, i.created_at,
              u.first_name || ' ' || u.last_name AS invited_by
         FROM team_invites i JOIN users u ON u.id = i.created_by
        WHERE i.team_id = ? AND i.status = 'pending' AND i.expires_at > ?
        ORDER BY i.created_at DESC`,
    )
      .bind(teamId, nowIso())
      .all<{ id: string; channel: string; recipient: string | null; role: Role; expires_at: string; created_at: string; invited_by: string }>();
    return c.json({
      invites: results.map((r) => ({
        id: r.id,
        channel: r.channel,
        email: r.recipient,
        role: r.role,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
        invitedBy: r.invited_by,
      })),
    });
  })

  /** QR007: invite someone by email, with a role. Re-inviting the same email replaces the old invite. */
  .post("/:teamId/invites", json(z.object({ email: emailField, role: roleField })), async (c) => {
    const teamId = c.req.param("teamId");
    const me = await requireMembership(c, teamId, MANAGERS);
    const { email, role } = c.req.valid("json");
    if (role === "approver" && me.role !== "approver") {
      fail(403, "Only an Approver can invite someone as an Approver.", { fields: { role: "Only an Approver can invite Approvers." } });
    }

    const existing = await c.env.DB.prepare(
      `SELECT m.status FROM team_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.team_id = ? AND u.email = ? AND m.status = 'active'`,
    )
      .bind(teamId, email)
      .first();
    if (existing) fail(409, "This person is already on the team.", { fields: { email: "This person is already on the team." } });

    const token = newSecretToken();
    const inviteId = newId();
    const rules = await c.env.DB.prepare("SELECT invite_expiry_days FROM teams WHERE id = ?").bind(teamId).first<{ invite_expiry_days: number }>();
    const expiresAt = days(rules?.invite_expiry_days ?? EMAIL_INVITE_DAYS);
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE team_invites SET status = 'revoked', updated_at = ? WHERE team_id = ? AND channel = 'email' AND recipient = ? AND status = 'pending'",
      ).bind(nowIso(), teamId, email),
      c.env.DB.prepare(
        `INSERT INTO team_invites (id, team_id, channel, recipient, role, token_hash, expires_at, created_by)
         VALUES (?, ?, 'email', ?, ?, ?, ?, ?)`,
      ).bind(inviteId, teamId, email, role, await sha256Hex(token), expiresAt, me.user_id),
    ]);

    const team = await c.env.DB.prepare("SELECT name FROM teams WHERE id = ?").bind(teamId).first<{ name: string }>();
    const inviter = currentUser(c);
    const link = `${c.env.APP_ORIGIN}/invite/${token}`;
    inBackground(
      c,
      sendEmail(c.env, { to: email, ...teamInviteEmail(`${inviter.firstName} ${inviter.lastName}`, team!.name, role, link) }),
    );
    return c.json({ invite: { id: inviteId, channel: "email", email, role, expiresAt } }, 201);
  })

  /**
   * QR001: create the team's shareable invite link. People who use it join as
   * Members and wait for an Approver or Admin to let them in. Creating a new
   * link turns off the old one. The link is only shown now; we store a hash.
   */
  .post("/:teamId/invite-link", async (c) => {
    const teamId = c.req.param("teamId");
    const me = await requireMembership(c, teamId, MANAGERS);
    const rules = await c.env.DB.prepare("SELECT invite_link_enabled FROM teams WHERE id = ?").bind(teamId).first<{ invite_link_enabled: number }>();
    if (rules?.invite_link_enabled === 0) fail(409, "The invite link is turned off for this team. Turn it on in Settings.", { code: "invite_link_disabled" });
    const token = newSecretToken();
    const expiresAt = days(LINK_INVITE_DAYS);
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE team_invites SET status = 'revoked', updated_at = ? WHERE team_id = ? AND channel = 'link' AND status = 'pending'",
      ).bind(nowIso(), teamId),
      c.env.DB.prepare(
        `INSERT INTO team_invites (id, team_id, channel, role, token_hash, expires_at, created_by)
         VALUES (?, ?, 'link', 'member', ?, ?, ?)`,
      ).bind(newId(), teamId, await sha256Hex(token), expiresAt, me.user_id),
    ]);
    return c.json({ url: `${c.env.APP_ORIGIN}/invite/${token}`, expiresAt }, 201);
  })

  /** Cancel an invitation or turn off the invite link. */
  .delete("/:teamId/invites/:inviteId", async (c) => {
    const { teamId, inviteId } = c.req.param();
    await requireMembership(c, teamId, MANAGERS);
    const res = await c.env.DB.prepare(
      "UPDATE team_invites SET status = 'revoked', updated_at = ? WHERE id = ? AND team_id = ? AND status = 'pending'",
    )
      .bind(nowIso(), inviteId, teamId)
      .run();
    if (!res.meta.changes) fail(404, "Invitation not found.");
    return c.json({ invite: { id: inviteId, status: "revoked" } });
  });

async function getMembership(c: Parameters<typeof requireMembership>[0], teamId: string, membershipId: string): Promise<Membership> {
  const m = await c.env.DB.prepare(
    "SELECT id, team_id, user_id, role, status FROM team_memberships WHERE id = ? AND team_id = ?",
  )
    .bind(membershipId, teamId)
    .first<Membership>();
  if (!m) fail(404, "Member not found.");
  return m;
}

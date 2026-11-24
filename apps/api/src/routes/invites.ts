import { Hono } from "hono";
import { linkGuestPlacesToMember } from "../teams/contacts";
import type { Context } from "hono";
import { sha256Hex } from "../auth/crypto";
import { currentUser, inBackground, requireVerifiedUser } from "../auth/session";
import type { AppEnv } from "../env";
import { fail } from "../errors";
import { newId, nowIso } from "../ids";
import { joinRequestEmail, sendEmail } from "../mail";
import type { Role } from "../teams/permissions";

interface InviteRow {
  id: string;
  team_id: string;
  team_name: string;
  channel: "email" | "sms" | "link";
  recipient: string | null;
  role: Role;
  status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: string;
  inviter_first: string;
  inviter_last: string;
}

async function findInvite(c: Context<AppEnv>, token: string): Promise<InviteRow> {
  if (token.length < 20 || token.length > 200) fail(404, "This invitation doesn't exist.", { code: "invite_invalid" });
  const invite = await c.env.DB.prepare(
    `SELECT i.id, i.team_id, t.name AS team_name, i.channel, i.recipient, i.role, i.status, i.expires_at,
            u.first_name AS inviter_first, u.last_name AS inviter_last
       FROM team_invites i
       JOIN teams t ON t.id = i.team_id
       JOIN users u ON u.id = i.created_by
      WHERE i.token_hash = ?`,
  )
    .bind(await sha256Hex(token))
    .first<InviteRow>();
  if (!invite || invite.status === "revoked") {
    fail(404, "This invitation has been cancelled or doesn't exist. Ask the team for a new one.", { code: "invite_invalid" });
  }
  if (invite.status === "accepted") fail(410, "This invitation has already been used.", { code: "invite_used" });
  if (invite.expires_at <= nowIso()) fail(410, "This invitation has expired. Ask the team for a new one.", { code: "invite_expired" });
  return invite;
}

/** Public invite pages and accepting an invitation. */
export const invites = new Hono<AppEnv>()
  /** What the invite landing page shows, before signing in. */
  .get("/:token", async (c) => {
    const invite = await findInvite(c, c.req.param("token"));
    return c.json({
      invite: {
        teamName: invite.team_name,
        invitedBy: `${invite.inviter_first} ${invite.inviter_last}`,
        channel: invite.channel,
        role: invite.role,
        email: invite.channel === "email" ? invite.recipient : null,
        needsApproval: invite.channel === "link",
        expiresAt: invite.expires_at,
      },
    });
  })

  /**
   * Accept an invitation.
   *  - Email invite (QR007): must be accepted by that email's account; joins straight away with the invited role.
   *  - Invite link (QR001): joins as a Member waiting for approval; Approvers and Admins are emailed.
   */
  .post("/:token/accept", requireVerifiedUser, async (c) => {
    const invite = await findInvite(c, c.req.param("token"));
    const user = currentUser(c);

    if (invite.channel === "email" && invite.recipient?.toLowerCase() !== user.email.toLowerCase()) {
      fail(403, `This invitation was sent to ${invite.recipient}. Log in with that email to accept it.`, { code: "invite_wrong_account" });
    }

    const existing = await c.env.DB.prepare("SELECT id, status, role FROM team_memberships WHERE team_id = ? AND user_id = ?")
      .bind(invite.team_id, user.id)
      .first<{ id: string; status: string; role: Role }>();

    const team = { id: invite.team_id, name: invite.team_name };
    const now = nowIso();

    if (invite.channel === "email") {
      const statements = [
        c.env.DB.prepare("UPDATE team_invites SET status = 'accepted', updated_at = ? WHERE id = ?").bind(now, invite.id),
      ];
      if (!existing) {
        statements.push(
          c.env.DB.prepare(
            "INSERT INTO team_memberships (id, team_id, user_id, role, status, approved_by) VALUES (?, ?, ?, ?, 'active', NULL)",
          ).bind(newId(), invite.team_id, user.id, invite.role),
        );
      } else if (existing.status !== "active") {
        statements.push(
          c.env.DB.prepare("UPDATE team_memberships SET role = ?, status = 'active', updated_at = ? WHERE id = ?").bind(
            invite.role,
            now,
            existing.id,
          ),
        );
      }
      await c.env.DB.batch(statements);
      // Places they had on the team's programs as a guest become theirs as a member.
      await linkGuestPlacesToMember(c.env.DB, invite.team_id, user.id, user.email);
      const role = existing?.status === "active" ? existing.role : invite.role;
      return c.json({ team: { ...team, role, status: "active" } });
    }

    // Invite link: the link stays usable for others until it expires or is replaced.
    if (existing?.status === "active") return c.json({ team: { ...team, role: existing.role, status: "active" } });
    const rules = await c.env.DB.prepare("SELECT invite_link_enabled, link_requires_approval FROM teams WHERE id = ?")
      .bind(invite.team_id)
      .first<{ invite_link_enabled: number; link_requires_approval: number }>();
    if (rules?.invite_link_enabled === 0) fail(410, "This team has turned off its invite link. Ask the team for an invitation.", { code: "invite_expired" });

    // Teams can choose to let people who use the link straight in (a Settings choice).
    if (rules?.link_requires_approval === 0) {
      await c.env.DB.prepare(
        existing
          ? "UPDATE team_memberships SET role = 'member', status = 'active', updated_at = ? WHERE id = ?"
          : "INSERT INTO team_memberships (id, team_id, user_id, role, status) VALUES (?, ?, ?, 'member', 'active')",
      )
        .bind(...(existing ? [now, existing.id] : [newId(), invite.team_id, user.id]))
        .run();
      await linkGuestPlacesToMember(c.env.DB, invite.team_id, user.id, user.email);
      return c.json({ team: { ...team, role: "member", status: "active" } });
    }
    if (existing?.status === "pending_vetting") return c.json({ team: { ...team, role: "member", status: "pending_vetting" } });

    if (existing) {
      await c.env.DB.prepare(
        "UPDATE team_memberships SET role = 'member', status = 'pending_vetting', approved_by = NULL, updated_at = ? WHERE id = ?",
      )
        .bind(now, existing.id)
        .run();
    } else {
      await c.env.DB.prepare(
        "INSERT INTO team_memberships (id, team_id, user_id, role, status) VALUES (?, ?, ?, 'member', 'pending_vetting')",
      )
        .bind(newId(), invite.team_id, user.id)
        .run();
    }

    // Tell the people who can let them in.
    const { results: managers } = await c.env.DB.prepare(
      `SELECT u.email FROM team_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.team_id = ? AND m.status = 'active' AND m.role IN ('approver', 'admin')`,
    )
      .bind(invite.team_id)
      .all<{ email: string }>();
    const message = joinRequestEmail(`${user.firstName} ${user.lastName}`, invite.team_name, `${c.env.APP_ORIGIN}/admin/people`);
    for (const m of managers) inBackground(c, sendEmail(c.env, { to: m.email, ...message }));

    return c.json({ team: { ...team, role: "member", status: "pending_vetting" } });
  });

import type { Context } from "hono";
import type { AppEnv } from "../env";
import { fail } from "../errors";

export type Role = "approver" | "admin" | "member";
export type MembershipStatus = "pending_vetting" | "active" | "removed";

export interface Membership {
  id: string;
  team_id: string;
  user_id: string;
  role: Role;
  status: MembershipStatus;
}

/** Admins and Planners (stored approver / admin) manage people and plan events. */
export const MANAGERS: readonly Role[] = ["approver", "admin"];

/**
 * The signed-in user's active membership of a team, checked against the
 * roles allowed. Non-members get 404 so team IDs can't be probed.
 */
export async function requireMembership(
  c: Context<AppEnv>,
  teamId: string,
  roles: readonly Role[] = ["approver", "admin", "member"],
): Promise<Membership> {
  const user = c.get("user");
  if (!user) fail(401, "Please log in.");
  const m = await c.env.DB.prepare(
    "SELECT id, team_id, user_id, role, status FROM team_memberships WHERE team_id = ? AND user_id = ?",
  )
    .bind(teamId, user.id)
    .first<Membership>();
  if (!m || m.status !== "active") fail(404, "Team not found.");
  if (!roles.includes(m.role)) fail(403, "You don't have permission to do that on this team.");
  return m;
}

export async function activeApproverCount(c: Context<AppEnv>, teamId: string): Promise<number> {
  const row = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM team_memberships WHERE team_id = ? AND role = 'approver' AND status = 'active'",
  )
    .bind(teamId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Rules for changing someone's role or removing them. Roles are stored as
 * approver / admin / member and shown as Admin / Planner / Member.
 *  - Only Admins (stored "approver") change roles, up or down.
 *  - Planners (stored "admin") can remove Members, but not Planners or Admins.
 *  - A team always keeps at least one active Admin (someone must be able to approve programs).
 * Leaving the team yourself is allowed for anyone (callers pass the actor as an Admin for that).
 */
export async function assertCanManage(
  c: Context<AppEnv>,
  actor: Membership,
  target: Membership,
  change: { newRole?: Role; removing?: boolean },
): Promise<void> {
  if (change.newRole && actor.role !== "approver") {
    fail(403, "Only an Admin can change people's roles.");
  }
  if (change.removing && actor.role !== "approver" && target.role !== "member") {
    fail(403, "Only an Admin can remove Planners and Admins.");
  }

  const losesApprover = target.role === "approver" && target.status === "active" && (change.removing || (change.newRole && change.newRole !== "approver"));
  if (losesApprover && (await activeApproverCount(c, target.team_id)) <= 1) {
    fail(409, "A team needs at least one Admin. Make someone else an Admin first.", { code: "last_approver" });
  }
}

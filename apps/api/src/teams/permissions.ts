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

/** Approvers and Admins can manage people (PRD §6.1: add users, vet invite-link joiners). */
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
 * Rules for changing someone's role or removing them:
 *  - Only Approvers can make someone an Approver, or change/remove an Approver.
 *  - A team always keeps at least one active Approver (someone must be able to approve events).
 */
export async function assertCanManage(
  c: Context<AppEnv>,
  actor: Membership,
  target: Membership,
  change: { newRole?: Role; removing?: boolean },
): Promise<void> {
  const touchesApprover = target.role === "approver" || change.newRole === "approver";
  if (touchesApprover && actor.role !== "approver") {
    fail(403, "Only an Approver can add, change or remove Approvers.");
  }

  const losesApprover = target.role === "approver" && target.status === "active" && (change.removing || (change.newRole && change.newRole !== "approver"));
  if (losesApprover && (await activeApproverCount(c, target.team_id)) <= 1) {
    fail(409, "A team needs at least one Approver. Make someone else an Approver first.", { code: "last_approver" });
  }
}

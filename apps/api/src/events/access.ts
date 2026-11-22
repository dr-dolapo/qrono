import type { Context } from "hono";
import type { AppEnv } from "../env";
import { fail } from "../errors";
import { MANAGERS, type Role } from "../teams/permissions";

export type EventStatus = "draft" | "review" | "approved" | "live" | "past";

export interface EventRow {
  id: string;
  team_id: string;
  name: string;
  description: string | null;
  start_at: string;
  end_at: string;
  timezone: string;
  status: EventStatus;
  progression_mode: "auto" | "manual";
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface EventAccess {
  event: EventRow;
  role: Role;
  canManage: boolean;
}

/**
 * Loads an event the signed-in user may see:
 *  - Approvers and Admins of its team see every event.
 *  - Members see events they're a participant in (PRD §6.1).
 * Anyone else gets 404, so event IDs can't be probed.
 */
export async function loadEvent(c: Context<AppEnv>, eventId: string): Promise<EventAccess> {
  const user = c.get("user");
  if (!user) fail(401, "Please log in.");

  const row = await c.env.DB.prepare(
    `SELECT e.*, m.role AS my_role,
            EXISTS (SELECT 1 FROM event_participants p WHERE p.event_id = e.id AND p.user_id = ?) AS is_participant
       FROM events e
       JOIN team_memberships m ON m.team_id = e.team_id AND m.user_id = ? AND m.status = 'active'
      WHERE e.id = ?`,
  )
    .bind(user.id, user.id, eventId)
    .first<EventRow & { my_role: Role; is_participant: number }>();

  if (!row) fail(404, "Event not found.");
  const canManage = MANAGERS.includes(row.my_role);
  if (!canManage && !row.is_participant) fail(404, "Event not found.");

  const { my_role, is_participant: _p, ...event } = row;
  return { event, role: my_role, canManage };
}

/** For changes to the plan: Approvers/Admins only, and only while the event is a draft (QR020). */
export async function loadEditableEvent(c: Context<AppEnv>, eventId: string): Promise<EventAccess> {
  const access = await loadEvent(c, eventId);
  if (!access.canManage) fail(403, "Only Approvers and Admins can edit events.");
  if (access.event.status !== "draft") {
    fail(409, "Only draft events can be edited.", { code: "event_not_draft" });
  }
  return access;
}

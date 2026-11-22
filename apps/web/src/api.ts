/** Error returned by the Qrono API: a message plus optional per-field messages. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Calls the API on the same origin with the session cookie. Throws ApiError on failure. */
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
      credentials: "same-origin",
      headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach Qrono. Check your connection and try again.");
  }

  const data = res.headers.get("Content-Type")?.includes("application/json") ? await res.json() : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? "Something went wrong. Please try again.", data?.fields, data?.code);
  }
  return data as T;
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  emailVerified: boolean;
}

export type Role = "approver" | "admin" | "member";

export interface TeamSummary {
  id: string;
  name: string;
  role: Role;
  status: "pending_vetting" | "active" | "removed";
}

export interface Member {
  id: string;
  role: Role;
  status: "pending_vetting" | "active";
  joinedAt: string;
  user: { id: string; firstName: string; lastName: string; email: string };
}

export interface PendingInvite {
  id: string;
  channel: "email" | "link" | "sms";
  email: string | null;
  role: Role;
  expiresAt: string;
  createdAt: string;
  invitedBy: string;
}

export interface InviteInfo {
  teamName: string;
  invitedBy: string;
  channel: "email" | "link" | "sms";
  role: Role;
  email: string | null;
  needsApproval: boolean;
  expiresAt: string;
}

export const ROLE_LABEL: Record<Role, string> = { approver: "Approver", admin: "Admin", member: "Member" };

export type EventStatus = "draft" | "review" | "approved" | "live" | "past";

export const STATUS_LABEL: Record<EventStatus, string> = {
  draft: "Draft",
  review: "In review",
  approved: "Approved",
  live: "Live",
  past: "Past",
};

export interface EventSummary {
  id: string;
  name: string;
  startAt: string;
  endAt: string;
  timezone: string;
  status: EventStatus;
  taskCount: number;
  participantCount: number;
}

export interface Stage {
  id: string;
  name: string;
  venue: string | null;
}

export interface Task {
  id: string;
  stageId: string | null;
  title: string;
  description: string | null;
  durationMinutes: number;
  status: string;
  startAt: string;
  endAt: string;
  assigneeIds: string[];
}

export interface Participant {
  id: string;
  kind: "member" | "guest";
  userId: string | null;
  name: string;
  email: string;
  response: "pending" | "acknowledged" | "declined";
}

export interface EventDetail {
  event: {
    id: string;
    teamId: string;
    name: string;
    description: string | null;
    startAt: string;
    endAt: string;
    timezone: string;
    status: EventStatus;
    progressionMode: "auto" | "manual";
  };
  permissions: { canEdit: boolean; canManage: boolean };
  stages: Stage[];
  tasks: Task[];
  participants: Participant[];
  schedule: { endsAt: string; overrunMinutes: number };
}

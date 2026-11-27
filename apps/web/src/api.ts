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
  /** Time zone new events use (a team setting). */
  timezone: string;
  clockFormat: "12h" | "24h";
  weekStart: "monday" | "sunday";
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

export const ROLE_LABEL: Record<Role, string> = { approver: "Admin", admin: "Planner", member: "Member" };

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
  /** People on the program without an email yet (managers only; otherwise 0). */
  missingEmailCount: number;
  /** In review and waiting for me to approve it. */
  awaitingMyApproval: boolean;
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
  /** Null: no length yet (a draft item that's just a title). */
  durationMinutes: number | null;
  status: string;
  startAt: string;
  endAt: string;
  assigneeIds: string[];
}

export interface Participant {
  id: string;
  kind: "member" | "guest";
  userId: string | null;
  /** For guests: who they are on the team's people list. */
  contactId: string | null;
  name: string;
  /** null for a guest whose email hasn't been added yet. */
  email: string | null;
  response: "pending" | "acknowledged" | "declined";
  declineReason: string | null;
  respondedAt: string | null;
}

export interface TaskComment {
  id: string;
  taskId: string;
  author: { id: string; name: string };
  body: string;
  postedDuring: EventStatus;
  createdAt: string;
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
  permissions: {
    canEdit: boolean;
    canManage: boolean;
    /** Drafts, and past events (to take them off everyone's list). */
    canDelete?: boolean;
    canSubmit: boolean;
    canPublish: boolean;
    canWithdraw: boolean;
    canApprove: boolean;
    canComment: boolean;
    canRespond: boolean;
    canRunLive: boolean;
  };
  me: {
    userId: string;
    participant: { id: string; response: Participant["response"]; declineReason: string | null } | null;
  };
  approvers: { userId: string; name: string; approvedAt: string | null }[];
  team: EventTeamInfo;
  comments: TaskComment[];
  stages: Stage[];
  tasks: Task[];
  participants: Participant[];
  schedule: { endsAt: string; overrunMinutes: number };
}

export interface GuestProgram {
  teamName: string;
  teamLogoUrl: string | null;
  venue: string | null;
  clockFormat: "12h" | "24h";
  /** When countdowns turn amber, as in the command centre. */
  liveWarningMinutes: number;
  event: { name: string; description: string | null; startAt: string; endAt: string; timezone: string; status: EventStatus };
  me: { name: string; response: Participant["response"]; declineReason: string | null };
  program: { id: string; title: string; durationMinutes: number; startAt: string; endAt: string; mine: boolean }[];
  /** While live: what's on now (guests poll for it). */
  live: {
    serverTime: string;
    currentTaskId: string | null;
    tasks: { id: string; status: "upcoming" | "in_progress" | "done" | "skipped"; actualStartAt: string | null }[];
  } | null;
}

/** Someone on the team's people list (GET /teams/:teamId/people). */
export type Person =
  | { kind: "member"; userId: string; name: string; email: string; status: "member" }
  | { kind: "contact"; contactId: string; name: string; email: string | null; status: "invited" | "not_invited" };

export const PERSON_STATUS_LABEL: Record<Person["status"], string> = {
  member: "Joined",
  invited: "Invited",
  not_invited: "Not invited yet",
};

/** A previous program to start an agenda from (GET /teams/:teamId/templates). */
export interface Template {
  eventId: string;
  name: string;
  startAt: string;
  timezone: string;
  items: number;
  minutes: number;
  /** Pinned to the top in Settings → Agenda library. */
  pinned?: boolean;
}

/**
 * The Duration dropdown, matching the API's rule: every minute from 1 to 15,
 * every 5 minutes to 60, then every 15 minutes to 120.
 */
export const AGENDA_DURATIONS: readonly number[] = [
  ...Array.from({ length: 15 }, (_, i) => i + 1),
  ...Array.from({ length: 9 }, (_, i) => 20 + i * 5),
  75,
  90,
  105,
  120,
];

/** Team-wide settings (Settings page; Admins and Planners). */
export interface TeamSettings {
  name: string;
  logo: string | null;
  defaultVenue: string | null;
  timezone: string;
  clockFormat: "12h" | "24h";
  weekStart: "monday" | "sunday";
  defaultStartTime: string | null;
  defaultProgression: "auto" | "manual";
  requireApproval: boolean;
  allowSelfApproval: boolean;
  defaultApproverIds: string[];
  remindersEnabled: boolean;
  reminderOffsets: number[];
  inviteDefaultRole: "admin" | "member";
  inviteExpiryDays: number;
  inviteLinkEnabled: boolean;
  linkRequiresApproval: boolean;
  liveWarningMinutes: number;
  liveShowNames: boolean;
}

export interface SettingsResponse {
  canEdit: boolean;
  canDeleteTeam: boolean;
  me: { reminderEmails: boolean };
  remindersEnabled: boolean;
  settings: TeamSettings | null;
}

/** Team rules and display choices sent with each event. */
export interface EventTeamInfo {
  name: string;
  clockFormat: "12h" | "24h";
  venue: string | null;
  requireApproval: boolean;
  allowSelfApproval: boolean;
  liveWarningMinutes: number;
  liveShowNames: boolean;
  submittedBy: string | null;
}

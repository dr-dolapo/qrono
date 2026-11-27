export type EventStatus = "draft" | "review" | "approved" | "live" | "past";
export type Response = "pending" | "acknowledged" | "declined";

/** One row of GET /api/me/events. */
export interface MyEvent {
  id: string;
  team: { id: string; name: string };
  name: string;
  startAt: string;
  endAt: string;
  timezone: string;
  status: EventStatus;
  myResponse: Response | null;
  myTaskCount: number;
  myNextTask: { title: string; startAt: string } | null;
  awaitingMyApproval: boolean;
}

/** GET /api/events/:id (the parts the app uses). */
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
  };
  /** The team's settings: when countdowns turn amber, and how programs get approved. */
  team?: { name: string; liveWarningMinutes: number; requireApproval: boolean; allowSelfApproval: boolean };
  permissions: {
    canRespond: boolean;
    canApprove: boolean;
    canDelete?: boolean;
    /** Admins and Planners: drafts are edited in the app's program builder. */
    canEdit?: boolean;
    canManage?: boolean;
    canSubmit?: boolean;
    canPublish?: boolean;
    /** Admins and Planners: start, skip and end the event from the live screen. */
    canRunLive?: boolean;
  };
  approvers: { userId: string; name: string; approvedAt: string | null }[];
  me: { userId: string; participant: { id: string; response: Response; declineReason: string | null } | null };
  stages: { id: string; name: string; venue: string | null }[];
  tasks: {
    id: string;
    stageId: string | null;
    title: string;
    description: string | null;
    /** Null: no length yet (a draft item that's just a title). */
    durationMinutes: number | null;
    status: "upcoming" | "in_progress" | "done" | "skipped";
    startAt: string;
    endAt: string;
    assigneeIds: string[];
  }[];
  participants: { id: string; name: string; kind: "member" | "guest"; userId: string | null; contactId: string | null; email: string | null }[];
}

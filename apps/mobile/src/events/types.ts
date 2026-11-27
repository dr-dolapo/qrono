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
  /** The team's live-screen settings: when countdowns turn amber. */
  team?: { liveWarningMinutes: number };
  permissions: { canRespond: boolean; canComment: boolean; canApprove: boolean; canDelete?: boolean };
  approvers: { userId: string; name: string; approvedAt: string | null }[];
  me: { userId: string; participant: { id: string; response: Response; declineReason: string | null } | null };
  stages: { id: string; name: string; venue: string | null }[];
  tasks: {
    id: string;
    stageId: string | null;
    title: string;
    description: string | null;
    durationMinutes: number;
    status: "upcoming" | "in_progress" | "done" | "skipped";
    startAt: string;
    endAt: string;
    assigneeIds: string[];
  }[];
  participants: { id: string; name: string; kind: "member" | "guest" }[];
  comments: {
    id: string;
    taskId: string;
    author: { id: string; name: string };
    body: string;
    postedDuring: EventStatus;
    createdAt: string;
  }[];
}

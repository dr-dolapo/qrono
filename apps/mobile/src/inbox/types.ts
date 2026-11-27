export type InboxAction = "approve" | "open" | "let_in" | "decline_join" | "confirm" | "decline_part" | "join_team" | "decline_invite" | "dismiss";

/** One row of GET /api/me/inbox. */
export interface InboxItem {
  key: string;
  kind: "approve" | "join" | "confirm" | "invite" | "part_added" | "part_changed" | "part_removed" | "program_approved" | "program_returned";
  teamId: string;
  teamName: string;
  eventId: string | null;
  title: string;
  body: string;
  at: string;
  unread: boolean;
  actions: InboxAction[];
  ref: { membershipId?: string; participantId?: string; inviteId?: string; noteId?: string; taskId?: string };
}

export interface InboxData {
  items: InboxItem[];
  unread: number;
}

export type ArchiveOutcome =
  | "approved"
  | "confirmed"
  | "declined_part"
  | "let_in"
  | "declined_join"
  | "joined_team"
  | "declined_invite"
  | "opened"
  | "dismissed";

/** One row of GET /api/me/inbox/archive: something you dealt with in the last 60 days. */
export interface ArchivedItem {
  key: string;
  outcome: ArchiveOutcome;
  title: string;
  detail: string | null;
  teamName: string | null;
  eventId: string | null;
  at: string;
}

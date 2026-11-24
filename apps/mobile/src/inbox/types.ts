export type InboxAction = "approve" | "open" | "let_in" | "decline_join" | "confirm" | "decline_part" | "join_team" | "decline_invite" | "dismiss";

/** One row of GET /api/me/inbox. */
export interface InboxItem {
  key: string;
  kind: "approve" | "join" | "confirm" | "invite" | "part_changed" | "part_removed" | "program_approved" | "program_returned" | "comment";
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

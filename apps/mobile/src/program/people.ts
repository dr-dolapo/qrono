import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { EventDetail } from "../events/types";

/** Someone who can run an item: a team member, or a contact (a guest, maybe without an email yet). */
export type TeamPerson =
  | { kind: "member"; userId: string; name: string; email: string }
  | { kind: "contact"; contactId: string; name: string; email: string | null };

export const personKey = (p: TeamPerson) => (p.kind === "member" ? `u:${p.userId}` : `c:${p.contactId}`);

/** What the API's `who` takes for this person. */
export const whoRef = (p: TeamPerson) => (p.kind === "member" ? { userId: p.userId } : { contactId: p.contactId });

/** The keys of the people already running an item (from the event's participants). */
export function keysFor(detail: EventDetail, assigneeIds: string[]): string[] {
  return assigneeIds
    .map((id) => detail.participants.find((p) => p.id === id))
    .map((p) => (p?.userId ? `u:${p.userId}` : p?.contactId ? `c:${p.contactId}` : null))
    .filter((k): k is string => k !== null);
}

/** The team's people list (Admins and Planners only), for choosing who runs an item. */
export function useTeamPeople(teamId: string) {
  const [people, setPeople] = useState<TeamPerson[]>([]);
  const load = useCallback(async () => {
    try {
      setPeople((await api<{ people: TeamPerson[] }>(`/teams/${encodeURIComponent(teamId)}/people`)).people);
    } catch {
      /* the sheet still works with who's already on the program */
    }
  }, [teamId]);
  useEffect(() => {
    void load();
  }, [load]);

  /** Adds a guest to the team's list (an email can come later) and returns them. */
  const addGuest = useCallback(
    async (name: string, email: string | null): Promise<TeamPerson> => {
      // With an email that's already a member's (or a saved contact's), that person comes back.
      const { person } = await api<{ person: TeamPerson }>(`/teams/${encodeURIComponent(teamId)}/people`, { body: { name, email } });
      setPeople((list) => (list.some((p) => personKey(p) === personKey(person)) ? list : [...list, person].sort((a, b) => a.name.localeCompare(b.name))));
      return person;
    },
    [teamId],
  );

  return { people, addGuest, reload: load };
}

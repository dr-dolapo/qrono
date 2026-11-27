import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type EventDetail } from "../../api";
import { Pushdown, type PushdownMessage } from "../../components/Pushdown";
import type { FaceTask } from "../../faces";
import { useClock } from "../../useClock";
import type { LiveState } from "../../useLiveEvent";
import { BroadcastAlerts } from "./Broadcasts";

interface MyBroadcast {
  id: string;
  body: string;
  sentBy: string;
  sentAt: string;
  response?: string;
}

/**
 * The event page for team members taking part (not running it), once it's approved or live:
 * the pushdown with Me, All and Messages. Admins and Planners keep the full page.
 */
export function MemberPushdown({
  detail,
  live,
  broadcastVersion,
  onUpdated,
}: {
  detail: EventDetail;
  live: { state: LiveState | null; clockOffset: number };
  broadcastVersion: number;
  onUpdated(d: EventDetail): void;
}) {
  const { event, tasks, participants, me } = detail;
  const now = useClock().getTime() + live.clockOffset;
  const participant = me.participant;
  const declined = participant?.response === "declined";

  // Messages sent to me, newest first. Unread: not yet answered, or newer than my last look.
  const [messages, setMessages] = useState<MyBroadcast[]>([]);
  const [seenAt, setSeenAt] = useState("");
  const loadMessages = useCallback(() => {
    api<{ broadcasts: MyBroadcast[] }>(`/events/${event.id}/broadcasts`)
      .then((r) => setMessages(r.broadcasts.filter((b) => typeof b.response === "string").sort((a, b) => b.sentAt.localeCompare(a.sentAt))))
      .catch(() => undefined);
  }, [event.id]);
  useEffect(loadMessages, [loadMessages, broadcastVersion]);

  const liveTasks = new Map((live.state?.tasks ?? []).map((t) => [t.id, t]));
  const names = new Map(participants.map((p) => [p.id, p.name]));
  const faceTasks: FaceTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    durationMinutes: t.durationMinutes,
    plannedStartAt: t.startAt,
    status: liveTasks.get(t.id)?.status ?? (t.status as FaceTask["status"]),
    actualStartAt: liveTasks.get(t.id)?.actualStartAt ?? null,
  }));
  const mine = new Set(participant && !declined ? tasks.filter((t) => t.assigneeIds.includes(participant.id)).map((t) => t.id) : []);

  async function respond(response: "acknowledged" | "declined", reason?: string) {
    try {
      onUpdated(await api<EventDetail>(`/events/${event.id}/response`, { body: response === "declined" ? { response, reason } : { response } }));
    } catch (err) {
      throw new Error(err instanceof ApiError ? (err.fields.reason ?? err.message) : "Something went wrong. Please try again.");
    }
  }

  const list: PushdownMessage[] = messages.map((m) => ({
    id: m.id,
    sentBy: m.sentBy,
    sentAt: m.sentAt,
    body: m.body,
    unread: m.response === "none" || (!!seenAt && m.sentAt > seenAt),
  }));

  return (
    <Pushdown
      now={now}
      timezone={event.timezone}
      input={{
        status: live.state?.event.status ?? event.status,
        startAt: event.startAt,
        currentTaskId: live.state?.currentTaskId ?? null,
        mine,
        warningMs: detail.team.liveWarningMinutes * 60_000,
        tasks: faceTasks,
      }}
      rows={tasks.map((t) => ({
        id: t.id,
        title: t.title,
        plannedStartAt: t.startAt,
        durationMinutes: t.durationMinutes,
        people: t.assigneeIds.map((id) => (id === participant?.id ? "You" : names.get(id) ?? "Someone")).join(", ") || null,
      }))}
      messages={list}
      onMessagesOpened={() => setSeenAt(new Date().toISOString())}
      back={{ to: "/admin", label: "Back to events" }}
      attendance={participant ? { declined, onDecline: (reason) => respond("declined", reason), onAttend: () => respond("acknowledged") } : null}
    >
      {/* Replies to broadcasts (Acknowledge, Snooze, Done) still pop up as they arrive. */}
      <BroadcastAlerts eventId={event.id} version={broadcastVersion} />
    </Pushdown>
  );
}

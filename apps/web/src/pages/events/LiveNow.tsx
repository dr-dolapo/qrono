import { useEffect } from "react";
import type { EventDetail } from "../../api";
import { CountdownHero } from "../../components/CountdownHero";
import { countdown } from "../../countdown";
import { useClock } from "../../useClock";
import type { LiveConnection, LiveState } from "../../useLiveEvent";

/**
 * Top of the event page once it's approved or live: the countdown to the start, or what's on now
 * and how long it has left, as the biggest thing on the page. People on the program also see the
 * countdown to their own part, in purple, when that's a different moment.
 */
export function LiveNow({
  detail,
  live,
  onStatusChange,
}: {
  detail: EventDetail;
  live: { state: LiveState | null; connection: LiveConnection; clockOffset: number };
  onStatusChange: () => void;
}) {
  const active = detail.event.status === "approved" || detail.event.status === "live";
  const { state, connection, clockOffset } = live;
  const now = useClock().getTime() + clockOffset;

  // When the room says the status changed (went live, ended), refresh the page's data.
  const liveStatus = state?.event.status;
  useEffect(() => {
    if (liveStatus && liveStatus !== detail.event.status) onStatusChange();
  }, [liveStatus, detail.event.status, onStatusChange]);

  if (!active) return null;
  const me = detail.me.participant;
  const mine = new Set(me ? detail.tasks.filter((t) => t.assigneeIds.includes(me.id)).map((t) => t.id) : []);
  const liveTasks = new Map((state?.tasks ?? []).map((t) => [t.id, t]));
  const { hero, myPart } = countdown({
    status: state?.event.status ?? detail.event.status,
    startAt: detail.event.startAt,
    currentTaskId: state?.currentTaskId ?? null,
    mine,
    now,
    tasks: detail.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      durationMinutes: t.durationMinutes ?? 0,
      startAt: t.startAt,
      status: liveTasks.get(t.id)?.status,
      actualStartAt: liveTasks.get(t.id)?.actualStartAt,
    })),
  });
  // Someone who declined doesn't get a countdown to a part they won't do.
  return <CountdownHero hero={hero} myPart={me?.response === "declined" ? null : myPart} reconnecting={!!state && connection !== "connected"} />;
}

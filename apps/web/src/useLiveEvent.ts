import { useEffect, useRef, useState } from "react";

export type LiveConnection = "connecting" | "connected" | "reconnecting";

export interface LiveTask {
  id: string;
  title: string;
  durationMinutes: number;
  plannedStartAt: string;
  status: "upcoming" | "in_progress" | "done" | "skipped";
  actualStartAt: string | null;
  actualEndAt: string | null;
  assignees: string[];
}

export interface LiveState {
  type: "state";
  serverTime: string;
  event: {
    id: string;
    name: string;
    status: "draft" | "review" | "approved" | "live" | "past";
    startAt: string;
    endAt: string;
    timezone: string;
    progressionMode: "auto" | "manual";
    endedEarlyAt: string | null;
  };
  currentTaskId: string | null;
  tasks: LiveTask[];
}

/**
 * Connects to the event's live room over WebSocket, keeps the latest state,
 * and reconnects automatically (venue Wi-Fi drops; screens must recover on
 * their own). `clockOffset` corrects for the viewer's clock being wrong.
 */
export function useLiveEvent(eventId: string | undefined, enabled = true) {
  const [connection, setConnection] = useState<LiveConnection>("connecting");
  const [state, setState] = useState<LiveState | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!eventId || !enabled) return;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let attempts = 0;
    let stopped = false;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${protocol}://${window.location.host}/api/events/${encodeURIComponent(eventId)}/live`);
      socketRef.current = socket;
      socket.onopen = () => {
        attempts = 0;
        setConnection("connected");
        clearInterval(pingTimer);
        // Keep idle connections from being dropped by proxies.
        pingTimer = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send("ping"), 25_000);
      };
      socket.onmessage = (e) => {
        if (typeof e.data !== "string" || e.data === "pong") return;
        try {
          const msg = JSON.parse(e.data) as LiveState;
          if (msg.type === "state") {
            setState(msg);
            setClockOffset(Date.parse(msg.serverTime) - Date.now());
          }
        } catch {
          /* ignore */
        }
      };
      socket.onclose = () => {
        clearInterval(pingTimer);
        if (stopped) return;
        setConnection("reconnecting");
        retryTimer = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** attempts++));
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      socketRef.current?.close();
    };
  }, [eventId, enabled]);

  return { connection, state, setState, clockOffset };
}

/** Derived view of the live agenda at a moment in time. */
export function liveView(state: LiveState, nowMs: number) {
  const current = state.tasks.find((t) => t.id === state.currentTaskId) ?? null;
  const upcoming = state.tasks.filter((t) => t.status === "upcoming");
  const next = upcoming[0] ?? null;
  let remainingMs: number | null = null;
  let progress = 0;
  if (current?.actualStartAt) {
    const total = current.durationMinutes * 60_000;
    const elapsed = nowMs - Date.parse(current.actualStartAt);
    remainingMs = total - elapsed;
    progress = Math.min(1, Math.max(0, elapsed / total));
  }
  // When the next task is expected to start: now + whatever is left of the current one.
  const nextExpectedAt = next ? nowMs + Math.max(0, remainingMs ?? 0) : null;
  return { current, next, later: upcoming.slice(1, 4), remainingMs, progress, nextExpectedAt };
}

/** 754_000 → "12:34"; negative values are formatted without a sign. */
export function formatCountdown(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

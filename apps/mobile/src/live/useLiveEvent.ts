import { reportOnline } from "../lib/connectivity";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { QRONO_URL } from "../config";
import { getAuthToken } from "../lib/api";

/** React Native's WebSocket takes request headers as a third argument (the browser one doesn't). */
const NativeWebSocket = WebSocket as unknown as new (
  url: string,
  protocols: string | string[] | null,
  options: { headers: Record<string, string> },
) => WebSocket;

export type LiveConnection = "connecting" | "connected" | "reconnecting";

/** Mirrors LiveSnapshot in apps/api/src/live/engine.ts. */
export interface LiveTask {
  id: string;
  title: string;
  durationMinutes: number;
  plannedStartAt: string;
  status: "upcoming" | "in_progress" | "done" | "skipped";
  actualStartAt: string | null;
  actualEndAt: string | null;
  /** Names, in roll-call order. */
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

export type LiveMessage =
  | { type: "broadcast"; broadcast: { id: string; body: string; sentBy: string; sentAt: string; realert: boolean } }
  | { type: "broadcasts-changed" }
  /** The plan changed (by: who changed it, on drafts). */
  | { type: "plan-changed"; by?: { userId: string | null; name: string | null } }
  /** Drafts: the Admins and Planners with it open, and the item each has open. */
  | { type: "presence"; editors: Editor[] };

export interface Editor {
  userId: string;
  name: string;
  taskId: string | null;
}

/**
 * Connects to the event's live room over WebSocket and keeps the latest state.
 * Reconnects by itself (venue Wi-Fi and mobile data drop out), and straight
 * away when the app comes back to the foreground. `clockOffset` corrects for
 * the phone's clock being off, so countdowns match the command centre.
 */
export function useLiveEvent(eventId: string, onMessage?: (msg: LiveMessage) => void) {
  const [connection, setConnection] = useState<LiveConnection>("connecting");
  const [state, setState] = useState<LiveState | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const onMessageRef = useRef(onMessage);
  const socketRef = useRef<WebSocket | null>(null);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let attempts = 0;
    let stopped = false;

    const url = `${QRONO_URL.replace(/^http/, "ws")}/api/events/${encodeURIComponent(eventId)}/live`;

    const connect = () => {
      clearTimeout(retryTimer);
      const token = getAuthToken();
      const headers: Record<string, string> = { "X-Qrono-Client": "mobile" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const ws = new NativeWebSocket(url, null, { headers });
      socket = ws;
      socketRef.current = ws;
      ws.onopen = () => {
        attempts = 0;
        setConnection("connected");
        reportOnline(true);
        clearInterval(pingTimer);
        // Keeps the connection from being dropped by mobile networks and proxies while idle.
        pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
      };
      ws.onmessage = (e) => {
        if (typeof e.data !== "string" || e.data === "pong") return;
        try {
          const msg = JSON.parse(e.data) as LiveState | LiveMessage;
          if (msg.type === "state") {
            setState(msg);
            setClockOffset(Date.parse(msg.serverTime) - Date.now());
          } else {
            onMessageRef.current?.(msg);
          }
        } catch {
          /* ignore anything we don't understand */
        }
      };
      ws.onclose = () => {
        clearInterval(pingTimer);
        if (stopped || socket !== ws) return;
        setConnection("reconnecting");
        retryTimer = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** attempts++));
      };
    };

    // Phones suspend connections in the background: reconnect as soon as the app is back.
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active" || stopped) return;
      if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
        attempts = 0;
        setConnection("reconnecting");
        connect();
      }
    });

    connect();
    return () => {
      stopped = true;
      sub.remove();
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      socket?.close();
    };
  }, [eventId]);

  /** Tells the others which item you have open (null: none), for "Ada is editing" markers. */
  const sendEditing = useCallback((taskId: string | null) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "editing", taskId }));
  }, []);

  return { connection, state, clockOffset, sendEditing };
}

/** What's on now, what's next, and when each upcoming task is expected to start. */
export function liveView(state: LiveState, nowMs: number) {
  const current = state.tasks.find((t) => t.id === state.currentTaskId) ?? null;
  const upcoming = state.tasks.filter((t) => t.status === "upcoming");
  let remainingMs: number | null = null;
  let progress = 0;
  if (current?.actualStartAt) {
    const total = current.durationMinutes * 60_000;
    const elapsed = nowMs - Date.parse(current.actualStartAt);
    remainingMs = total - elapsed;
    progress = Math.min(1, Math.max(0, elapsed / total));
  }
  // Each upcoming task is expected once everything before it has run for its planned length.
  const expectedAt = new Map<string, number>();
  let cursor = state.event.status === "live" ? nowMs + Math.max(0, remainingMs ?? 0) : Date.parse(state.event.startAt);
  for (const t of upcoming) {
    expectedAt.set(t.id, cursor);
    cursor += t.durationMinutes * 60_000;
  }
  return { current, next: upcoming[0] ?? null, upcoming, remainingMs, progress, expectedAt };
}

/** 754_000 → "12:34"; negative values are shown without a sign. */
export function formatClock(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

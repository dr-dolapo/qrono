import { useEffect, useState } from "react";

export type LiveConnection = "connecting" | "connected" | "reconnecting";

/**
 * Connects to the event's LiveEvent Durable Object over WebSocket and
 * reconnects automatically (venue Wi-Fi drops; the screen must recover on its own).
 */
export function useLiveEvent(eventId: string | undefined): {
  connection: LiveConnection;
  lastMessage: unknown;
} {
  const [connection, setConnection] = useState<LiveConnection>("connecting");
  const [lastMessage, setLastMessage] = useState<unknown>(null);

  useEffect(() => {
    if (!eventId) return;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let stopped = false;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${window.location.host}/api/events/${encodeURIComponent(eventId)}/live`);
      socket.onopen = () => {
        attempts = 0;
        setConnection("connected");
      };
      socket.onmessage = (e) => {
        try {
          setLastMessage(JSON.parse(e.data as string));
        } catch {
          setLastMessage(e.data);
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        setConnection("reconnecting");
        const delay = Math.min(30_000, 1_000 * 2 ** attempts++);
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      socket?.close();
    };
  }, [eventId]);

  return { connection, lastMessage };
}

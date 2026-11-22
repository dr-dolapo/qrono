import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

/**
 * One instance per Live event (addressed by event ID).
 *
 * Responsibilities (PRD §7, §9.5, §9.6):
 *  - hold the current task and push agenda changes to every connected client
 *    (mobile app, command centre, guest view) over WebSockets
 *  - run auto-progression with Durable Object alarms (QR027)
 *  - deliver broadcasts and re-alert snoozed ones after 3 minutes (QR038–QR042)
 *
 * This is the foundation only: it accepts WebSocket connections (using the
 * hibernation API so idle connections cost nothing) and relays state.
 * Agenda progression and broadcasts are built on top of it in later PRs.
 */
export class LiveEvent extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ type: "hello", connections: this.ctx.getWebSockets().length }));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string" && message === "ping") {
      ws.send("pong");
    }
  }

  async webSocketClose(_ws: WebSocket, _code: number, _reason: string): Promise<void> {
    // The runtime completes the close handshake itself on this compatibility
    // date; calling ws.close() here would throw. Presence tracking goes here later.
  }

  /** Send a message to every connected client. */
  protected broadcastToAll(payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        // Socket already closed; the runtime cleans it up.
      }
    }
  }
}

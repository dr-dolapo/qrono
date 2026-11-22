import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { runCommand, type LiveCommand } from "./live/commands";
import { snapshot, tick } from "./live/engine";

/**
 * One instance per event (addressed by event ID): the live "room".
 *
 *  - Every screen watching the event (command centre, participants' pages)
 *    holds a WebSocket here and gets the full state whenever it changes.
 *  - Admin commands (start, next task, end) arrive from the Worker, which has
 *    already checked permissions.
 *  - A Durable Object alarm wakes the room exactly when something is due:
 *    the start time, an automatic hand-over (QR027), or the end time.
 *
 * The database (D1) is the source of truth; the room only coordinates.
 * WebSockets use the hibernation API, so idle connections cost nothing.
 */
export class LiveEvent extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const eventId = request.headers.get("X-Qrono-Event");
    if (!eventId) return new Response("Missing event", { status: 400 });
    await this.ctx.storage.put("eventId", eventId);

    if (url.pathname === "/connect") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket upgrade", { status: 426 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      this.ctx.acceptWebSocket(server, [request.headers.get("X-Qrono-Viewer") ?? "participant"]);
      server.send(JSON.stringify(await snapshot(this.env.DB, eventId, Date.now())));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/command" && request.method === "POST") {
      const cmd = (await request.json()) as LiveCommand;
      const result = await runCommand(this.env.DB, eventId, cmd, Date.now());
      if (result.ok) await this.afterChange(result.wakeAt, result.snapshot);
      return Response.json(result, { status: result.status });
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const eventId = await this.ctx.storage.get<string>("eventId");
    if (!eventId) return;
    const now = Date.now();
    const wakeAt = await tick(this.env.DB, eventId, now);
    await this.afterChange(wakeAt, await snapshot(this.env.DB, eventId, now));
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === "ping") ws.send("pong");
  }

  async webSocketClose(): Promise<void> {
    // The runtime completes the close handshake itself on this compatibility date.
  }

  private async afterChange(wakeAt: number | null, state: unknown): Promise<void> {
    if (wakeAt === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(wakeAt, Date.now() + 250));
    const data = JSON.stringify(state);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        // Already closed; the runtime cleans it up.
      }
    }
  }
}

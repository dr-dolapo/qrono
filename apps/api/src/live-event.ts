import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { runCommand, type CommandResult, type LiveCommand } from "./live/commands";
import { sendEmail } from "./mail";
import { pushBroadcasts } from "./push";
import { snapshot } from "./live/engine";
import { notifyNote } from "./inbox";
import { syncLiveCards } from "./live/cards";

/**
 * One instance per event (addressed by event ID): the live "room".
 *
 *  - Every screen watching the event (command centre, participants' pages)
 *    holds a WebSocket here and gets the full state whenever it changes.
 *  - Planner commands (start, next task, end) arrive from the Worker, which has
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
      // Tags let the room reach Admins/Planners, or one person (broadcast alerts).
      const tags = [request.headers.get("X-Qrono-Viewer") ?? "participant"];
      const userId = request.headers.get("X-Qrono-User");
      if (userId) tags.push(`user:${userId}`);
      this.ctx.acceptWebSocket(server, tags);
      server.send(JSON.stringify(await snapshot(this.env.DB, eventId, Date.now())));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/command" && request.method === "POST") {
      const cmd = (await request.json()) as LiveCommand;
      const result = await runCommand(this.env.DB, eventId, cmd, Date.now(), this.hooks());
      if (result.ok) await this.afterChange(result);
      return Response.json(result, { status: result.status });
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const eventId = await this.ctx.storage.get<string>("eventId");
    if (!eventId) return;
    const result = await runCommand(this.env.DB, eventId, { action: "tick", by: null }, Date.now(), this.hooks());
    if (result.ok) await this.afterChange(result);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === "ping") ws.send("pong");
  }

  async webSocketClose(): Promise<void> {
    // The runtime completes the close handshake itself on this compatibility date.
  }

  private async afterChange(result: CommandResult): Promise<void> {
    if (result.wakeAt === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(result.wakeAt, Date.now() + 250));

    send(this.ctx.getWebSockets(), JSON.stringify(result.snapshot));
    for (const d of result.deliveries) send(this.ctx.getWebSockets(`user:${d.userId}`), JSON.stringify(d.message));
    // Also push broadcasts to recipients' phones (QR040), so they're seen with the app closed.
    if (result.deliveries.length) {
      const eventId = await this.ctx.storage.get<string>("eventId");
      if (eventId) this.ctx.waitUntil(pushBroadcasts(this.env, eventId, result.deliveries).catch((err) => console.error("Push failed", err)));
    }
    // Lock-screen cards (iOS Live Activities, Android Live Updates): only changed ones are pushed.
    const id = await this.ctx.storage.get<string>("eventId");
    if (id && (result.snapshot?.event.status === "live" || result.snapshot?.event.status === "past")) {
      this.ctx.waitUntil(
        syncLiveCards(this.env, id)
          .then(async ({ changesAt }) => {
            // Cards change colour on their own (amber in the warning window, red when over time):
            // wake the room then too, so the lock screens follow.
            if (changesAt === null) return;
            const due = await this.ctx.storage.getAlarm();
            if (due === null || changesAt < due) await this.ctx.storage.setAlarm(Math.max(changesAt, Date.now() + 250));
          })
          .catch((err) => console.error("Live card sync failed", err)),
      );
    }
    if (result.broadcastsChanged) send(this.ctx.getWebSockets("manager"), JSON.stringify({ type: "broadcasts-changed" }));
    if (result.planChanged) send(this.ctx.getWebSockets(), JSON.stringify({ type: "plan-changed" }));
  }

  /** How the room emails change notices. */
  private hooks() {
    return {
      appOrigin: this.env.APP_ORIGIN,
      send: (email: Parameters<typeof sendEmail>[1]) => sendEmail(this.env, email),
      note: (userIds: string[], note: Parameters<typeof notifyNote>[2]) => notifyNote(this.env, userIds, note),
    };
  }
}

function send(sockets: WebSocket[], data: string): void {
  for (const ws of sockets) {
    try {
      ws.send(data);
    } catch {
      // Already closed; the runtime cleans it up.
    }
  }
}

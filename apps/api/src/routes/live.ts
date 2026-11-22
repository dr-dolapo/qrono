import { Hono } from "hono";
import type { Context } from "hono";
import { currentUser, requireVerifiedUser } from "../auth/session";
import type { AppEnv } from "../env";
import { fail } from "../errors";
import { loadEvent } from "../events/access";
import type { CommandResult, LiveAction } from "../live/commands";

/** Send a command to the event's live room (the LiveEvent Durable Object). */
export async function liveCommand(c: Context<AppEnv>, eventId: string, action: LiveAction, by: string | null): Promise<CommandResult> {
  const room = c.env.LIVE_EVENT.get(c.env.LIVE_EVENT.idFromName(eventId));
  const res = await room.fetch("https://live/command", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Qrono-Event": eventId },
    body: JSON.stringify({ action, by }),
  });
  return (await res.json()) as CommandResult;
}

/** Running an event live: the shared screen connection and Admin controls. */
export const live = new Hono<AppEnv>()
  .use(requireVerifiedUser)

  /**
   * WebSocket for anyone who can see the event: Approvers/Admins (command
   * centre) and participants (their live view). Checked against the app's
   * origin so other sites can't open it with the user's cookie.
   */
  .get("/:eventId/live", async (c) => {
    if (c.req.header("Upgrade") !== "websocket") return c.json({ error: "Expected a WebSocket upgrade" }, 426);
    const origin = c.req.header("Origin");
    if (origin && origin !== c.env.APP_ORIGIN) return c.json({ error: "Cross-site request blocked." }, 403);
    const access = await loadEvent(c, c.req.param("eventId"));
    const room = c.env.LIVE_EVENT.get(c.env.LIVE_EVENT.idFromName(access.event.id));
    const headers = new Headers(c.req.raw.headers);
    headers.set("X-Qrono-Event", access.event.id);
    headers.set("X-Qrono-Viewer", access.canManage ? "manager" : "participant");
    return room.fetch(new Request("https://live/connect", { headers }));
  })

  /** Start early, move to the next task, or end the event (QR028, QR029). Approvers and Admins only. */
  .post("/:eventId/live/:action{start|next|end}", async (c) => {
    const access = await loadEvent(c, c.req.param("eventId"));
    if (!access.canManage) fail(403, "Only Approvers and Admins can run the event.");
    const result = await liveCommand(c, access.event.id, c.req.param("action") as LiveAction, currentUser(c).id);
    if (!result.ok) fail(result.status as 404 | 409, result.error ?? "That didn't work.");
    return c.json(result.snapshot);
  });

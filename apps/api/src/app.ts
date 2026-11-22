import { Hono } from "hono";
import { loadSession } from "./auth/session";
import type { AppEnv } from "./env";
import { auth } from "./routes/auth";
import { teams } from "./routes/teams";
import { sameOriginOnly, securityHeaders } from "./security";

export const app = new Hono<AppEnv>().basePath("/api");

app.use(securityHeaders);

/** Liveness + database check. */
app.get("/health", async (c) => {
  let database: "ok" | "error" = "ok";
  try {
    await c.env.DB.prepare("SELECT 1 AS ok").first();
  } catch {
    database = "error";
  }
  const status = database === "ok" ? 200 : 503;
  return c.json({ service: "qrono-api", env: c.env.APP_ENV, database }, status);
});

app.use(sameOriginOnly);
app.use(loadSession);

app.route("/auth", auth);
app.route("/teams", teams);

/**
 * WebSocket entry point for a live event. Every client watching the same
 * event connects to the same LiveEvent Durable Object.
 * TODO: authenticate (session for members, personal link for guests) and
 * check the event is Live before connecting.
 */
app.get("/events/:eventId/live", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.json({ error: "Expected a WebSocket upgrade" }, 426);
  }
  const id = c.env.LIVE_EVENT.idFromName(c.req.param("eventId"));
  return c.env.LIVE_EVENT.get(id).fetch(c.req.raw);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  console.error("Unhandled error", err);
  return c.json({ error: "Something went wrong. Please try again." }, 500);
});

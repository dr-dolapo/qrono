import { Hono } from "hono";
import { etag } from "hono/etag";
import { HTTPException } from "hono/http-exception";
import { loadSession } from "./auth/session";
import type { AppEnv } from "./env";
import { auth } from "./routes/auth";
import { broadcasts } from "./routes/broadcasts";
import { events, teamEvents } from "./routes/events";
import { guest } from "./routes/guest";
import { invites } from "./routes/invites";
import { live } from "./routes/live";
import { me } from "./routes/me";
import { planning } from "./routes/planning";
import { settings } from "./routes/settings";
import { review } from "./routes/review";
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

/**
 * A team's logo, public so mail apps and guests' pages can show it. Only the image the
 * team chose in Settings is served, as its own content type; nothing else is exposed.
 */
app.get("/teams/:teamId/logo", async (c) => {
  const row = await c.env.DB.prepare("SELECT logo_data FROM teams WHERE id = ?").bind(c.req.param("teamId")).first<{ logo_data: string | null }>();
  const match = row?.logo_data?.match(/^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,(.+)$/);
  if (!match) return c.json({ error: "Not found" }, 404);
  const bytes = Uint8Array.from(atob(match[2]!), (ch) => ch.charCodeAt(0));
  return c.body(bytes, 200, {
    "Content-Type": match[1]!,
    "Cache-Control": "public, max-age=86400",
    // SVGs can carry scripts: never run them, and never let this be framed or sniffed.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "X-Content-Type-Options": "nosniff",
  });
});

app.use(sameOriginOnly);
app.use(loadSession);

// Phones keep saved copies and check "has this changed?" by sending the version they have
// (If-None-Match). Unchanged, the answer is a few bytes instead of the whole event.
app.use("/events/*", etag());
app.use("/me/events", etag());
app.use("/guest/*", etag());

app.route("/auth", auth);
app.route("/me", me);
app.route("/teams", teams);
app.route("/invites", invites);
app.route("/teams", teamEvents);
app.route("/teams", planning);
app.route("/teams", settings);
app.route("/events", events);
app.route("/events", review);
app.route("/events", live);
app.route("/events", broadcasts);
app.route("/guest", guest);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error("Unhandled error", err);
  return c.json({ error: "Something went wrong. Please try again." }, 500);
});

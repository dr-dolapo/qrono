import { Hono } from "hono";
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

app.use(sameOriginOnly);
app.use(loadSession);

app.route("/auth", auth);
app.route("/me", me);
app.route("/teams", teams);
app.route("/invites", invites);
app.route("/teams", teamEvents);
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

import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, AuthedUser } from "../env";
import { newId } from "../ids";
import { newSecretToken, sha256Hex } from "./crypto";

export const SESSION_COOKIE = "qrono_session";
/** Sent by the mobile app. It gets its session token in the response body instead of a cookie. */
export const CLIENT_HEADER = "X-Qrono-Client";
const SESSION_DAYS = 30;
/** Only write last_seen_at at most this often, to keep reads cheap. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

interface SessionRow {
  session_id: string;
  expires_at: string;
  last_seen_at: string;
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  email_verified_at: string | null;
}

/** Let work finish after the response is sent (falls back to fire-and-forget outside Workers). */
export function inBackground(c: Context<AppEnv>, work: Promise<unknown>): void {
  const guarded = work.catch((err) => console.error("Background task failed", err));
  try {
    c.executionCtx.waitUntil(guarded);
  } catch {
    void guarded;
  }
}

function isSecure(c: Context<AppEnv>): boolean {
  return c.env.APP_ORIGIN.startsWith("https://");
}

/** True when the request comes from the mobile app, which keeps its session token itself. */
export function isMobileClient(c: Context<AppEnv>): boolean {
  return c.req.header(CLIENT_HEADER)?.toLowerCase() === "mobile";
}

/** The token from an `Authorization: Bearer <token>` header, if any. */
function bearerToken(c: Context<AppEnv>): string | null {
  const match = c.req.header("Authorization")?.match(/^Bearer\s+([A-Za-z0-9_-]{20,200})$/);
  return match?.[1] ?? null;
}

export interface NewSession {
  token: string;
  expiresAt: string;
}

/**
 * Create a session for the user.
 * The web app gets an httpOnly cookie. The mobile app (see isMobileClient) gets no cookie:
 * it stores the returned token securely and sends it as `Authorization: Bearer <token>`.
 */
export async function startSession(c: Context<AppEnv>, userId: string): Promise<NewSession> {
  const token = newSecretToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await c.env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(newId(), userId, await sha256Hex(token), expires.toISOString(), c.req.header("User-Agent")?.slice(0, 300) ?? null)
    .run();

  if (!isMobileClient(c)) {
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: isSecure(c),
      sameSite: "Lax",
      path: "/",
      expires,
    });
  }
  return { token, expiresAt: expires.toISOString() };
}

/** End the current session (if any) and clear the cookie. */
export async function endSession(c: Context<AppEnv>): Promise<void> {
  const sessionId = c.get("sessionId");
  if (sessionId) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isSecure(c) });
}

/**
 * Reads the session (a bearer token from the mobile app, otherwise the web cookie)
 * and sets c.var.user (or null) for every request.
 */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", null);
  c.set("sessionId", null);

  const bearer = bearerToken(c);
  const token = bearer ?? getCookie(c, SESSION_COOKIE);
  if (token) {
    const row = await c.env.DB.prepare(
      `SELECT s.id AS session_id, s.expires_at, s.last_seen_at,
              u.id, u.first_name, u.last_name, u.email, u.email_verified_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
      .bind(await sha256Hex(token))
      .first<SessionRow>();

    const now = Date.now();
    if (row && Date.parse(row.expires_at) > now) {
      c.set("sessionId", row.session_id);
      c.set("user", {
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        emailVerified: row.email_verified_at !== null,
      });
      if (now - Date.parse(row.last_seen_at) > TOUCH_INTERVAL_MS) {
        inBackground(
          c,
          c.env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?")
            .bind(new Date(now).toISOString(), row.session_id)
            .run(),
        );
      }
    } else {
      if (row) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(row.session_id).run();
      if (!bearer) deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isSecure(c) });
    }
  }
  await next();
};

/** 401 unless signed in. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")) return c.json({ error: "Please log in." }, 401);
  await next();
};

/** 403 unless signed in with a verified email (QR003). */
export const requireVerifiedUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Please log in." }, 401);
  if (!user.emailVerified) return c.json({ error: "Please confirm your email address first.", code: "email_unverified" }, 403);
  await next();
};

export function currentUser(c: Context<AppEnv>): AuthedUser {
  const user = c.get("user");
  if (!user) throw new Error("currentUser() used on a route without requireUser");
  return user;
}

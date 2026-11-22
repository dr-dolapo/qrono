import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./env";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cross-site request protection for cookie-authenticated requests.
 * - Requests that change data must come from the web app's own origin.
 * - Bodies must be JSON, which a third-party HTML form cannot send.
 * Together with SameSite=Lax cookies, this blocks CSRF.
 */
export const sameOriginOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();

  const origin = c.req.header("Origin");
  if (origin && origin !== c.env.APP_ORIGIN) {
    return c.json({ error: "Cross-site request blocked." }, 403);
  }

  const hasBody = c.req.header("Content-Length") !== "0" && c.req.header("Content-Type") !== undefined;
  if (hasBody && !c.req.header("Content-Type")!.toLowerCase().startsWith("application/json")) {
    return c.json({ error: "Requests must be sent as JSON." }, 415);
  }
  await next();
};

/** Standard security headers on every API response. */
export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Cache-Control", "no-store");
};

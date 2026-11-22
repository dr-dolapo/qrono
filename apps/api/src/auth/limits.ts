import type { Context } from "hono";
import type { AppEnv } from "../env";

/**
 * Limits on repeated attempts, stored in D1 so they hold across every
 * Cloudflare location (unlike in-memory counters).
 *
 * A rule allows `max` attempts per `windowMinutes`. Reaching the limit blocks
 * the key for `blockMinutes`.
 */
export interface Rule {
  max: number;
  windowMinutes: number;
  blockMinutes: number;
}

export const RULES = {
  /** Wrong passwords for one email address: 5 in 15 minutes locks it for 15 minutes. */
  loginPerEmail: { max: 5, windowMinutes: 15, blockMinutes: 15 },
  /** Wrong passwords from one network address across any emails (password spraying). */
  loginPerIp: { max: 30, windowMinutes: 15, blockMinutes: 15 },
  // Caps below allow exactly `max` per window (see useAllowance).
  /** Password-reset emails to one address. */
  resetPerEmail: { max: 5, windowMinutes: 60, blockMinutes: 60 },
  /** Verification emails for one account. */
  verifyPerUser: { max: 5, windowMinutes: 60, blockMinutes: 60 },
  /** Sign-ups from one network address. */
  signupPerIp: { max: 20, windowMinutes: 60, blockMinutes: 60 },
} satisfies Record<string, Rule>;

const iso = (ms: number) => new Date(ms).toISOString();

/** The visitor's network address, as Cloudflare reports it. */
export function clientIp(c: Context<AppEnv>): string {
  return c.req.header("CF-Connecting-IP") ?? "unknown";
}

/** If the key is currently blocked, when the block ends. */
export async function blockedUntil(db: D1Database, key: string, now = Date.now()): Promise<number | null> {
  const row = await db.prepare("SELECT blocked_until FROM rate_limits WHERE key = ?").bind(key).first<{ blocked_until: string | null }>();
  if (!row?.blocked_until) return null;
  const until = Date.parse(row.blocked_until);
  return until > now ? until : null;
}

/**
 * Count one attempt. Returns when the key is now blocked until, if this
 * attempt reached the limit (or it was already blocked).
 */
export async function recordAttempt(db: D1Database, key: string, rule: Rule, now = Date.now()): Promise<number | null> {
  const windowStartedBefore = iso(now - rule.windowMinutes * 60_000);
  // One statement, so concurrent attempts can't both slip under the limit.
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT (key) DO UPDATE SET
         count        = CASE WHEN window_start <= ? THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END
       RETURNING count, blocked_until`,
    )
    .bind(key, iso(now), windowStartedBefore, windowStartedBefore)
    .first<{ count: number; blocked_until: string | null }>();

  const existing = row?.blocked_until ? Date.parse(row.blocked_until) : null;
  if (existing && existing > now) return existing;
  if ((row?.count ?? 0) >= rule.max) {
    const until = now + rule.blockMinutes * 60_000;
    await db.prepare("UPDATE rate_limits SET blocked_until = ? WHERE key = ?").bind(iso(until), key).run();
    return until;
  }
  return null;
}

/**
 * For caps on actions (sending emails, signing up): refuse only once the
 * allowance is used up, so exactly `rule.max` go through per window.
 * Returns when the cap lifts if this one is refused, otherwise counts it.
 */
export async function useAllowance(db: D1Database, key: string, rule: Rule, now = Date.now()): Promise<number | null> {
  const blocked = await blockedUntil(db, key, now);
  if (blocked) return blocked;
  await recordAttempt(db, key, rule, now);
  return null;
}

/** Forget a key's history (e.g. after a successful login or a password reset). */
export async function clearAttempts(db: D1Database, ...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db.prepare(`DELETE FROM rate_limits WHERE key IN (${keys.map(() => "?").join(",")})`).bind(...keys).run();
}

/** "15 minutes", "1 minute" — rounded up. */
export function minutesFrom(now: number, until: number): string {
  const m = Math.max(1, Math.ceil((until - now) / 60_000));
  return `${m} minute${m === 1 ? "" : "s"}`;
}

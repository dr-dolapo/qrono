/**
 * Test client: calls the Hono app in-process with a real SQLite-backed DB,
 * keeps the session cookie between calls like a browser would, and captures
 * emails instead of sending them.
 */
import { vi } from "vitest";
import { app } from "../../src/app";
import type { Env } from "../../src/env";
import { createTestDb } from "./d1";

export const ORIGIN = "http://localhost:5173";

export interface SentEmail {
  to: string;
  subject: string;
  text: string;
}

export function createTestEnv() {
  const { db, sqlite } = createTestDb();
  const emails: SentEmail[] = [];
  const env: Env = {
    DB: db,
    LIVE_EVENT: {} as Env["LIVE_EVENT"],
    APP_ENV: "test",
    APP_ORIGIN: ORIGIN,
    EMAIL_MODE: "send",
    MAIL_FROM: "Qrono <no-reply@example.com>",
    EMAIL: {
      send: vi.fn(async (m) => {
        emails.push({ to: String(m.to), subject: m.subject, text: m.text ?? "" });
        return { messageId: `m${emails.length}` };
      }),
    },
  };
  return { env, sqlite, emails };
}

export class Browser {
  private cookie: string | null = null;

  constructor(private readonly env: Env) {}

  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const init: RequestInit = {
      method,
      headers: {
        Origin: ORIGIN,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    };
    const res = await app.request(path, init, this.env);
    // Apply every Set-Cookie in order, as a browser does (e.g. clear a stale cookie, then set a new one).
    for (const setCookie of res.headers.getSetCookie()) {
      const [pair] = setCookie.split(";");
      const [name, value] = pair!.split("=");
      const cleared = !value || /Max-Age=0|expires=Thu, 01 Jan 1970/i.test(setCookie);
      this.cookie = cleared ? null : `${name}=${value}`;
    }
    // Let background work (emails) finish before assertions.
    await new Promise((r) => setTimeout(r, 0));
    const json = res.headers.get("Content-Type")?.includes("application/json") ? await res.json() : null;
    return { status: res.status, json: json as any, headers: res.headers };
  }

  get = (path: string) => this.request("GET", path);
  post = (path: string, body: unknown = {}) => this.request("POST", path, body);

  get hasSession(): boolean {
    return this.cookie !== null;
  }
}

/** Pull the token out of the most recent email's link. */
export function tokenFromEmail(email: SentEmail | undefined): string {
  const match = email?.text.match(/token=([A-Za-z0-9_\-%]+)/);
  if (!match) throw new Error(`No token link in email: ${email?.text}`);
  return decodeURIComponent(match[1]!);
}

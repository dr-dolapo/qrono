import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import type { Env } from "../src/env";

function envWith(db: Partial<D1Database>): Env {
  return {
    DB: db as D1Database,
    LIVE_EVENT: {} as Env["LIVE_EVENT"],
    APP_ENV: "test",
    APP_ORIGIN: "http://localhost:5173",
    EMAIL_MODE: "log",
    MAIL_FROM: "Qrono <no-reply@example.com>",
  };
}

const workingDb = {
  prepare: () => ({ first: async () => ({ ok: 1 }) }),
} as unknown as D1Database;

const brokenDb = {
  prepare: () => ({
    first: async () => {
      throw new Error("D1 unavailable");
    },
  }),
} as unknown as D1Database;

describe("GET /api/health", () => {
  it("reports ok when the database answers", async () => {
    const res = await app.request("/api/health", {}, envWith(workingDb));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ service: "qrono-api", env: "test", database: "ok" });
  });

  it("returns 503 when the database is down", async () => {
    const res = await app.request("/api/health", {}, envWith(brokenDb));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ database: "error" });
  });
});

describe("GET /api/events/:id/live", () => {
  it("rejects non-WebSocket requests", async () => {
    const res = await app.request("/api/events/abc/live", {}, envWith(workingDb));
    expect(res.status).toBe(426);
  });
});

describe("unknown routes", () => {
  it("return JSON 404", async () => {
    const res = await app.request("/api/nope", {}, envWith(workingDb));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});

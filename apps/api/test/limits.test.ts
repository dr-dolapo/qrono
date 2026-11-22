import { beforeEach, describe, expect, it } from "vitest";
import { RULES, blockedUntil, recordAttempt } from "../src/auth/limits";
import { Browser, createTestEnv, tokenFromEmail } from "./helpers/client";
import { createTestDb } from "./helpers/d1";

const MIN = 60_000;

describe("recordAttempt", () => {
  let db: D1Database;
  beforeEach(() => {
    ({ db } = createTestDb());
  });
  const rule = { max: 3, windowMinutes: 10, blockMinutes: 5 };
  const T = Date.parse("2026-12-01T09:00:00.000Z");

  it("blocks when the limit is reached, then lets go", async () => {
    expect(await recordAttempt(db, "k", rule, T)).toBeNull();
    expect(await recordAttempt(db, "k", rule, T + MIN)).toBeNull();
    expect(await recordAttempt(db, "k", rule, T + 2 * MIN)).toBe(T + 7 * MIN);
    expect(await blockedUntil(db, "k", T + 6 * MIN)).toBe(T + 7 * MIN);
    expect(await blockedUntil(db, "k", T + 8 * MIN)).toBeNull();
  });

  it("starts counting again once the window has passed", async () => {
    await recordAttempt(db, "k", rule, T);
    await recordAttempt(db, "k", rule, T + MIN);
    // 11 minutes later: the earlier attempts no longer count.
    expect(await recordAttempt(db, "k", rule, T + 11 * MIN)).toBeNull();
    expect(await recordAttempt(db, "k", rule, T + 12 * MIN)).toBeNull();
    expect(await recordAttempt(db, "k", rule, T + 13 * MIN)).not.toBeNull();
  });

  it("keeps keys separate", async () => {
    for (let i = 0; i < 3; i++) await recordAttempt(db, "a", rule, T);
    expect(await blockedUntil(db, "a", T)).not.toBeNull();
    expect(await blockedUntil(db, "b", T)).toBeNull();
  });
});

describe("login limits", () => {
  let t: ReturnType<typeof createTestEnv>;
  const ada = { firstName: "Ada", lastName: "Okafor", email: "ada@example.com", password: "correct horse battery" };
  const login = (b: Browser, password: string, email = ada.email, ip = "203.0.113.7") =>
    b.request("POST", "/api/auth/login", { email, password }, { "CF-Connecting-IP": ip });

  beforeEach(async () => {
    t = createTestEnv();
    const b = new Browser(t.env);
    await b.post("/api/auth/signup", ada);
    await b.post("/api/auth/verify-email", { token: tokenFromEmail(t.emails.at(-1)) });
  });

  it("pauses an account after 5 wrong passwords, even for the right one", async () => {
    const b = new Browser(t.env);
    for (let i = 0; i < 4; i++) expect((await login(b, "wrong password")).status).toBe(401);
    const fifth = await login(b, "wrong password");
    expect(fifth.status).toBe(429);
    expect(fifth.json.code).toBe("too_many_attempts");
    expect(fifth.json.error).toMatch(/paused for 15 minutes/);
    expect(fifth.headers.get("Retry-After")).toBe("900");

    const right = await login(b, ada.password);
    expect(right.status).toBe(429);
    expect(b.hasSession).toBe(false);
  });

  it("lets them back in after 15 minutes", async () => {
    const b = new Browser(t.env);
    for (let i = 0; i < 5; i++) await login(b, "wrong password");
    t.sqlite.exec("UPDATE rate_limits SET blocked_until = '2000-01-01T00:00:00.000Z', window_start = '2000-01-01T00:00:00.000Z'");
    expect((await login(b, ada.password)).status).toBe(200);
  });

  it("a successful login clears earlier mistakes", async () => {
    const b = new Browser(t.env);
    for (let i = 0; i < 4; i++) await login(b, "wrong password");
    expect((await login(b, ada.password)).status).toBe(200);
    await b.post("/api/auth/logout");
    for (let i = 0; i < 4; i++) expect((await login(b, "wrong password")).status).toBe(401);
  });

  it("resetting the password lifts the pause", async () => {
    const b = new Browser(t.env);
    for (let i = 0; i < 5; i++) await login(b, "wrong password");
    await b.post("/api/auth/forgot-password", { email: ada.email });
    await b.post("/api/auth/reset-password", { token: tokenFromEmail(t.emails.at(-1)), password: "a brand new password" });
    expect((await login(b, "a brand new password")).status).toBe(200);
  });

  it("behaves the same for emails without an account, so it can't be used to find accounts", async () => {
    const b = new Browser(t.env);
    const real: number[] = [];
    const fake: number[] = [];
    for (let i = 0; i < 6; i++) real.push((await login(b, "wrong", ada.email, "198.51.100.1")).status);
    for (let i = 0; i < 6; i++) fake.push((await login(b, "wrong", "nobody@example.com", "198.51.100.2")).status);
    expect(real).toEqual([401, 401, 401, 401, 429, 429]);
    expect(fake).toEqual(real);
  });

  it("pauses a network address that tries many accounts", async () => {
    const b = new Browser(t.env);
    for (let i = 0; i < RULES.loginPerIp.max; i++) await login(b, "wrong", `victim${i}@example.com`, "192.0.2.50");
    // Ada's account itself has no failures, but this address is paused.
    expect((await login(b, ada.password, ada.email, "192.0.2.50")).status).toBe(429);
    // Someone on another network is unaffected.
    expect((await login(new Browser(t.env), ada.password, ada.email, "192.0.2.99")).status).toBe(200);
  });
});

describe("email limits", () => {
  let t: ReturnType<typeof createTestEnv>;
  beforeEach(() => {
    t = createTestEnv();
  });

  it("caps password-reset emails per address without revealing it", async () => {
    const b = new Browser(t.env);
    await b.post("/api/auth/signup", { firstName: "Ada", lastName: "O", email: "ada@example.com", password: "correct horse battery" });
    const before = t.emails.length;
    for (let i = 0; i < 8; i++) expect((await b.post("/api/auth/forgot-password", { email: "ada@example.com" })).status).toBe(200);
    expect(t.emails.length - before).toBe(RULES.resetPerEmail.max);
  });

  it("caps verification emails per account", async () => {
    const b = new Browser(t.env);
    await b.post("/api/auth/signup", { firstName: "Ada", lastName: "O", email: "ada@example.com", password: "correct horse battery" });
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await b.post("/api/auth/resend-verification")).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("caps sign-ups per network address", async () => {
    const statuses = [];
    for (let i = 0; i < RULES.signupPerIp.max + 1; i++) {
      const res = await new Browser(t.env).request(
        "POST",
        "/api/auth/signup",
        { firstName: "P", lastName: "Q", email: `p${i}@example.com`, password: "correct horse battery" },
        { "CF-Connecting-IP": "192.0.2.10" },
      );
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(RULES.signupPerIp.max);
    expect(statuses.at(-1)).toBe(429);
  });
});

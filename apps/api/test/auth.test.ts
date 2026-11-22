import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/crypto";
import { Browser, createTestEnv, tokenFromEmail } from "./helpers/client";

const ada = { firstName: "Ada", lastName: "Okafor", email: "Ada@Example.com", password: "correct horse battery" };

let t: ReturnType<typeof createTestEnv>;
let browser: Browser;

beforeEach(() => {
  t = createTestEnv();
  browser = new Browser(t.env);
});

async function signUpAndVerify(b = browser) {
  await b.post("/api/auth/signup", ada);
  await b.post("/api/auth/verify-email", { token: tokenFromEmail(t.emails.at(-1)) });
}

describe("passwords", () => {
  it("hashes with a random salt and verifies", async () => {
    const h1 = await hashPassword("secret password");
    const h2 = await hashPassword("secret password");
    expect(h1).not.toBe(h2);
    expect(h1).toMatch(/^pbkdf2\$100000\$/);
    expect(await verifyPassword("secret password", h1)).toBe(true);
    expect(await verifyPassword("wrong password", h1)).toBe(false);
    expect(await verifyPassword("anything", "garbage")).toBe(false);
  });
});

describe("sign up (QR002)", () => {
  it("creates the account, signs in, and emails a verification link", async () => {
    const res = await browser.post("/api/auth/signup", ada);
    expect(res.status).toBe(201);
    expect(res.json.user).toMatchObject({ firstName: "Ada", email: "ada@example.com", emailVerified: false });
    expect(browser.hasSession).toBe(true);
    expect(t.emails).toHaveLength(1);
    expect(t.emails[0]).toMatchObject({ to: "ada@example.com", subject: "Confirm your email for Qrono" });
    expect(t.emails[0]!.text).toContain("http://localhost:5173/verify-email?token=");
  });

  it("never stores the plain password", async () => {
    await browser.post("/api/auth/signup", ada);
    const row = t.sqlite.prepare("SELECT password_hash FROM users").get() as { password_hash: string };
    expect(row.password_hash).not.toContain(ada.password);
  });

  it("rejects a duplicate email regardless of case", async () => {
    await browser.post("/api/auth/signup", ada);
    const res = await new Browser(t.env).post("/api/auth/signup", { ...ada, email: "ADA@example.com" });
    expect(res.status).toBe(409);
    expect(res.json.fields.email).toMatch(/already exists/);
  });

  it("returns a message per invalid field", async () => {
    const res = await browser.post("/api/auth/signup", { firstName: " ", lastName: "O", email: "nope", password: "short" });
    expect(res.status).toBe(400);
    expect(Object.keys(res.json.fields).sort()).toEqual(["email", "firstName", "password"]);
    expect(res.json.fields.password).toBe("Use at least 10 characters.");
  });
});

describe("email verification (QR003)", () => {
  it("verifies with the emailed link, once", async () => {
    await browser.post("/api/auth/signup", ada);
    const token = tokenFromEmail(t.emails[0]);

    expect((await browser.post("/api/auth/verify-email", { token })).status).toBe(200);
    expect((await browser.get("/api/auth/me")).json.user.emailVerified).toBe(true);
    expect((await browser.post("/api/auth/verify-email", { token })).status).toBe(400);
  });

  it("rejects an expired link", async () => {
    await browser.post("/api/auth/signup", ada);
    t.sqlite.exec("UPDATE auth_tokens SET expires_at = '2000-01-01T00:00:00.000Z'");
    const res = await browser.post("/api/auth/verify-email", { token: tokenFromEmail(t.emails[0]) });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("token_invalid");
  });

  it("resending replaces the old link", async () => {
    await browser.post("/api/auth/signup", ada);
    const first = tokenFromEmail(t.emails[0]);
    await browser.post("/api/auth/resend-verification");
    expect(t.emails).toHaveLength(2);
    expect((await browser.post("/api/auth/verify-email", { token: first })).status).toBe(400);
    expect((await browser.post("/api/auth/verify-email", { token: tokenFromEmail(t.emails[1]) })).status).toBe(200);
  });
});

describe("log in and out (QR004)", () => {
  beforeEach(async () => {
    await signUpAndVerify();
    await browser.post("/api/auth/logout");
  });

  it("logs out and clears the session", async () => {
    expect(browser.hasSession).toBe(false);
    expect((await browser.get("/api/auth/me")).status).toBe(401);
  });

  it("logs in with any email casing", async () => {
    const res = await browser.post("/api/auth/login", { email: "ADA@example.COM", password: ada.password });
    expect(res.status).toBe(200);
    expect(res.json.user.emailVerified).toBe(true);
    expect((await browser.get("/api/auth/me")).status).toBe(200);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const wrongPassword = await browser.post("/api/auth/login", { email: ada.email, password: "not the password" });
    const unknownEmail = await browser.post("/api/auth/login", { email: "nobody@example.com", password: "whatever123" });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.json).toEqual(unknownEmail.json);
    expect(browser.hasSession).toBe(false);
  });

  it("rejects a forged or expired session cookie", async () => {
    const forged = await browser.request("GET", "/api/auth/me", undefined, { Cookie: "qrono_session=forged-token" });
    expect(forged.status).toBe(401);

    await browser.post("/api/auth/login", { email: ada.email, password: ada.password });
    t.sqlite.exec("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'");
    expect((await browser.get("/api/auth/me")).status).toBe(401);
  });

  it("sets a hardened session cookie", async () => {
    const res = await browser.post("/api/auth/login", { email: ada.email, password: ada.password });
    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
  });
});

describe("password reset (QR005)", () => {
  it("does not reveal whether an email has an account", async () => {
    const res = await browser.post("/api/auth/forgot-password", { email: "nobody@example.com" });
    expect(res.status).toBe(200);
    expect(t.emails).toHaveLength(0);
  });

  it("resets the password and signs out every device", async () => {
    await signUpAndVerify();
    const otherDevice = new Browser(t.env);
    await otherDevice.post("/api/auth/login", { email: ada.email, password: ada.password });

    await browser.post("/api/auth/forgot-password", { email: ada.email });
    const token = tokenFromEmail(t.emails.at(-1));
    const res = await browser.post("/api/auth/reset-password", { token, password: "a brand new password" });
    expect(res.status).toBe(200);

    expect((await otherDevice.get("/api/auth/me")).status).toBe(401);
    expect((await browser.post("/api/auth/login", { email: ada.email, password: ada.password })).status).toBe(401);
    expect((await browser.post("/api/auth/login", { email: ada.email, password: "a brand new password" })).status).toBe(200);
    expect((await browser.post("/api/auth/reset-password", { token, password: "yet another password" })).status).toBe(400);
  });

  it("counts a reset as verifying the email", async () => {
    await browser.post("/api/auth/signup", ada);
    await browser.post("/api/auth/forgot-password", { email: ada.email });
    await browser.post("/api/auth/reset-password", { token: tokenFromEmail(t.emails.at(-1)), password: "a brand new password" });
    await browser.post("/api/auth/login", { email: ada.email, password: "a brand new password" });
    expect((await browser.get("/api/auth/me")).json.user.emailVerified).toBe(true);
  });
});

describe("cross-site protection", () => {
  it("blocks requests from another origin", async () => {
    const res = await browser.request("POST", "/api/auth/signup", ada, { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("blocks form-encoded bodies", async () => {
    const res = await browser.request("POST", "/api/auth/login", undefined, {
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(res.status).toBe(415);
  });
});

describe("emails", () => {
  it("in log mode, prints instead of sending", async () => {
    t.env.EMAIL_MODE = "log";
    await browser.post("/api/auth/signup", ada);
    expect(t.emails).toHaveLength(0);
  });
});

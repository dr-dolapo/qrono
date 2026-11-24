import { beforeEach, describe, expect, it } from "vitest";
import { Browser, createTestEnv, tokenFromEmail } from "./helpers/client";

let t: ReturnType<typeof createTestEnv>;
let browser: Browser;

beforeEach(async () => {
  t = createTestEnv();
  browser = new Browser(t.env);
  await browser.post("/api/auth/signup", {
    firstName: "Ada",
    lastName: "Okafor",
    email: "ada@example.com",
    password: "correct horse battery",
  });
});

const verify = () => browser.post("/api/auth/verify-email", { token: tokenFromEmail(t.emails.at(-1)) });

describe("teams (QR006, QR010)", () => {
  it("requires a confirmed email", async () => {
    const res = await browser.post("/api/teams", { name: "Events Team" });
    expect(res.status).toBe(403);
    expect(res.json.code).toBe("email_unverified");
  });

  it("requires being logged in", async () => {
    const res = await new Browser(t.env).post("/api/teams", { name: "Events Team" });
    expect(res.status).toBe(401);
  });

  it("creates a team with the creator as its Approver", async () => {
    await verify();
    const res = await browser.post("/api/teams", { name: "  Events Team  ", timezone: "Africa/Lagos" });
    expect(res.status).toBe(201);
    expect(res.json.team).toMatchObject({ name: "Events Team", role: "approver", status: "active" });

    const me = await browser.get("/api/auth/me");
    expect(me.json.teams).toEqual([{ id: res.json.team.id, name: "Events Team", timezone: "Africa/Lagos", clockFormat: "12h", weekStart: "monday", role: "approver", status: "active" }]);
  });

  it("lets a user belong to several teams", async () => {
    await verify();
    await browser.post("/api/teams", { name: "Events Team" });
    await browser.post("/api/teams", { name: "Church Programs" });
    const res = await browser.get("/api/teams");
    expect(res.json.teams.map((x: { name: string }) => x.name)).toEqual(["Events Team", "Church Programs"]);
  });

  it("validates the name", async () => {
    await verify();
    const res = await browser.post("/api/teams", { name: "A" });
    expect(res.status).toBe(400);
    expect(res.json.fields.name).toBe("Use at least 2 characters.");
  });
});

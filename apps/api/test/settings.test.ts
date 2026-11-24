import { beforeEach, describe, expect, it } from "vitest";
import { sendDueReminders } from "../src/reminders";
import { Browser, createTestEnv, tokenFromEmail } from "./helpers/client";

let t: ReturnType<typeof createTestEnv>;
let ada: Browser; // Approver, creates the team
let adaId: string;
let teamId: string;

const START = "2030-06-01T17:00:00.000Z";
const HOUR = 3_600_000;

async function person(first: string, email: string): Promise<Browser> {
  const b = new Browser(t.env);
  await b.post("/api/auth/signup", { firstName: first, lastName: "Test", email, password: "correct horse battery" });
  await b.post("/api/auth/verify-email", { token: tokenFromEmail(t.emails.at(-1)) });
  return b;
}

async function join(first: string, email: string, role: "approver" | "admin" | "member" = "member") {
  await ada.post(`/api/teams/${teamId}/invites`, { email, role });
  const token = t.emails.at(-1)!.text.match(/\/invite\/([A-Za-z0-9_-]+)/)![1];
  const browser = await person(first, email);
  await browser.post(`/api/invites/${token}/accept`);
  const userId = (await browser.get("/api/auth/me")).json.user.id as string;
  return { browser, userId };
}

async function programWith(who: { userId?: string; contactId?: string }[], name = "Monday Meeting") {
  const id = (await ada.post(`/api/teams/${teamId}/events`, { name, startAt: START })).json.event.id as string;
  for (const w of who) await ada.post(`/api/events/${id}/tasks`, { title: "Opening prayer", durationMinutes: 15, who: [w] });
  return id;
}

async function approve(id: string) {
  await ada.post(`/api/events/${id}/submit`, { approverIds: [adaId] });
  return ada.post(`/api/events/${id}/approve`);
}

beforeEach(async () => {
  t = createTestEnv();
  ada = await person("Ada", "ada@example.com");
  adaId = (await ada.get("/api/auth/me")).json.user.id;
  teamId = (await ada.post("/api/teams", { name: "Events Team", timezone: "Africa/Lagos" })).json.team.id;
});

describe("who sees and changes settings", () => {
  it("shows Members only their own settings, which they can change", async () => {
    const chi = await join("Chi", "chi@example.com");
    const mine = (await chi.browser.get(`/api/teams/${teamId}/settings`)).json;
    expect(mine).toMatchObject({ canEdit: false, settings: null, me: { reminderEmails: true }, remindersEnabled: true });
    expect((await chi.browser.request("PATCH", `/api/teams/${teamId}/settings`, { clockFormat: "24h" })).status).toBe(403);
    expect((await chi.browser.request("PATCH", `/api/teams/${teamId}/settings/me`, { reminderEmails: false })).json.me.reminderEmails).toBe(false);
    expect((await chi.browser.get(`/api/teams/${teamId}/settings`)).json.me.reminderEmails).toBe(false);
  });

  it("lets Admins change team settings, and checks them", async () => {
    const bola = await join("Bola", "bola@example.com", "admin");
    const res = await bola.browser.request("PATCH", `/api/teams/${teamId}/settings`, {
      name: "Tend Events",
      defaultVenue: "Main hall",
      clockFormat: "24h",
      weekStart: "sunday",
      defaultStartTime: "18:00",
      defaultProgression: "auto",
      reminderOffsets: [60, 1440],
      inviteExpiryDays: 14,
      liveWarningMinutes: 2,
      liveShowNames: false,
    });
    expect(res.json.settings).toMatchObject({
      name: "Tend Events",
      defaultVenue: "Main hall",
      clockFormat: "24h",
      weekStart: "sunday",
      defaultStartTime: "18:00",
      defaultProgression: "auto",
      reminderOffsets: [1440, 60],
      inviteExpiryDays: 14,
      liveWarningMinutes: 2,
      liveShowNames: false,
    });
    const bad = await bola.browser.request("PATCH", `/api/teams/${teamId}/settings`, { reminderOffsets: [45], defaultStartTime: "18:10", inviteExpiryDays: 9 });
    expect(Object.keys(bad.json.fields).sort()).toEqual(["defaultStartTime", "inviteExpiryDays", "reminderOffsets.0"]);
    // New events take the team's defaults.
    const id = (await ada.post(`/api/teams/${teamId}/events`, { name: "Carol Service", startAt: START })).json.event.id;
    expect((await ada.get(`/api/events/${id}`)).json.event.progressionMode).toBe("auto");
  });

  it("keeps the danger zone for Approvers", async () => {
    const bola = await join("Bola", "bola@example.com", "admin");
    expect((await bola.browser.request("DELETE", `/api/teams/${teamId}`, { confirmName: "Events Team" })).status).toBe(403);
    expect((await ada.request("DELETE", `/api/teams/${teamId}`, { confirmName: "Events" })).json.fields.confirmName).toBeDefined();
    expect((await ada.request("DELETE", `/api/teams/${teamId}`, { confirmName: "Events Team" })).status).toBe(200);
    expect((await ada.get("/api/auth/me")).json.teams).toEqual([]);
  });

  it("hands the team over: the new person becomes an Approver and you leave", async () => {
    const chi = await join("Chi", "chi@example.com");
    const members = (await ada.get(`/api/teams/${teamId}/members`)).json.members;
    const chiMembership = members.find((m: { user: { id: string } }) => m.user.id === chi.userId).id;
    expect((await ada.post(`/api/teams/${teamId}/handover`, { membershipId: chiMembership })).status).toBe(200);
    expect((await chi.browser.get("/api/auth/me")).json.teams[0]).toMatchObject({ role: "approver", status: "active" });
    expect((await ada.get("/api/auth/me")).json.teams).toEqual([]);
  });
});

describe("approval rules", () => {
  it("lets Admins publish directly when the team doesn't require approval", async () => {
    const chi = await join("Chi", "chi@example.com");
    const id = await programWith([{ userId: chi.userId }]);
    expect((await ada.post(`/api/events/${id}/publish`)).json.code).toBe("approval_required");

    await ada.request("PATCH", `/api/teams/${teamId}/settings`, { requireApproval: false });
    expect((await ada.get(`/api/events/${id}`)).json.permissions).toMatchObject({ canPublish: true, canSubmit: false });
    t.emails.length = 0;
    const res = await ada.post(`/api/events/${id}/publish`);
    expect(res.json.event.status).toBe("approved");
    await new Promise((r) => setTimeout(r, 30));
    expect(t.emails.some((e) => e.to === "chi@example.com" && /on the program/.test(e.subject))).toBe(true);
  });

  it("stops people approving programs they sent, when the team says so", async () => {
    await ada.request("PATCH", `/api/teams/${teamId}/settings`, { allowSelfApproval: false });
    const chi = await join("Chi", "chi@example.com");
    const id = await programWith([{ userId: chi.userId }]);
    const own = await ada.post(`/api/events/${id}/submit`, { approverIds: [adaId] });
    expect(own.json.fields.approverIds).toMatch(/Choose another Approver/);

    const bola = await join("Bola", "bola@example.com", "approver");
    expect((await ada.post(`/api/events/${id}/submit`, { approverIds: [bola.userId] })).status).toBe(200);
    expect((await bola.browser.post(`/api/events/${id}/approve`)).status).toBe(200);
  });

  it("remembers default Approvers, and only Approvers can be defaults", async () => {
    const bola = await join("Bola", "bola@example.com", "approver");
    const chi = await join("Chi", "chi@example.com");
    expect((await ada.request("PATCH", `/api/teams/${teamId}/settings`, { defaultApproverIds: [chi.userId] })).json.fields.defaultApproverIds).toBeDefined();
    const ok = await ada.request("PATCH", `/api/teams/${teamId}/settings`, { defaultApproverIds: [bola.userId] });
    expect(ok.json.settings.defaultApproverIds).toEqual([bola.userId]);
  });
});

describe("invites", () => {
  it("uses the team's expiry, can turn the invite link off, and can let link joiners straight in", async () => {
    await ada.request("PATCH", `/api/teams/${teamId}/settings`, { inviteExpiryDays: 3 });
    const invite = (await ada.post(`/api/teams/${teamId}/invites`, { email: "zed@example.com", role: "member" })).json.invite;
    expect(Date.parse(invite.expiresAt) - Date.now()).toBeLessThan(3 * 24 * HOUR + 60_000);

    const { url } = (await ada.post(`/api/teams/${teamId}/invite-link`)).json;
    const token = url.split("/invite/")[1];
    await ada.request("PATCH", `/api/teams/${teamId}/settings`, { linkRequiresApproval: false });
    const dayo = await person("Dayo", "dayo@example.com");
    expect((await dayo.post(`/api/invites/${token}/accept`)).json.team.status).toBe("active");

    await ada.request("PATCH", `/api/teams/${teamId}/settings`, { inviteLinkEnabled: false });
    const eve = await person("Eve", "eve@example.com");
    expect((await eve.post(`/api/invites/${token}/accept`)).status).toBe(404); // turning it off cancels it
    expect((await ada.post(`/api/teams/${teamId}/invite-link`)).json.code).toBe("invite_link_disabled");
  });
});

describe("reminders", () => {
  it("emails everyone on an approved program at the chosen times, once each", async () => {
    const chi = await join("Chi", "chi@example.com");
    const dayo = await join("Dayo", "dayo@example.com");
    const guest = (await ada.post(`/api/teams/${teamId}/people`, { name: "Funmi", email: "funmi@example.com" })).json.person;
    const id = await programWith([{ userId: chi.userId }, { userId: dayo.userId }, { contactId: guest.contactId }]);
    expect((await approve(id)).status).toBe(200);
    // Dayo has turned reminders off for himself.
    await dayo.browser.request("PATCH", `/api/teams/${teamId}/settings/me`, { reminderEmails: false });

    const start = Date.parse(START);
    t.emails.length = 0;
    expect(await sendDueReminders(t.env, start - 30 * HOUR)).toBe(0); // too early
    expect(await sendDueReminders(t.env, start - 24 * HOUR + 60_000)).toBe(2);
    expect(t.emails.map((e) => e.to).sort()).toEqual(["chi@example.com", "funmi@example.com"]);
    expect(t.emails[0]!.subject).toBe("Reminder: Monday Meeting tomorrow");
    expect(t.emails.find((e) => e.to === "chi@example.com")!.text).toContain("6:00 PM  Opening prayer");

    // The next run doesn't repeat it; the hour-before one comes later.
    expect(await sendDueReminders(t.env, start - 24 * HOUR + 5 * 60_000)).toBe(0);
    expect(await sendDueReminders(t.env, start - HOUR + 60_000)).toBe(2);
    expect(t.emails.at(-1)!.subject).toBe("Reminder: Monday Meeting in 1 hour");
  });

  it("skips reminders whose moment passed long ago, and sends none when the team turns them off", async () => {
    const chi = await join("Chi", "chi@example.com");
    const id = await programWith([{ userId: chi.userId }]);
    await approve(id);
    const start = Date.parse(START);
    t.emails.length = 0;
    // Approved late: only 3 hours to go, so the day-before reminder is stale and the hour-before one isn't due yet.
    expect(await sendDueReminders(t.env, start - 3 * HOUR)).toBe(0);

    await ada.request("PATCH", `/api/teams/${teamId}/settings`, { remindersEnabled: false });
    expect(await sendDueReminders(t.env, start - HOUR + 60_000)).toBe(0);
  });
});

describe("agenda library and logo", () => {
  it("hides suggestions and pins templates", async () => {
    const chi = await join("Chi", "chi@example.com");
    const id = await programWith([{ userId: chi.userId }]);
    await approve(id);
    const lib = (await ada.get(`/api/teams/${teamId}/library`)).json;
    expect(lib.suggestions).toEqual([{ title: "Opening prayer", uses: 1, hidden: false }]);

    await ada.request("PUT", `/api/teams/${teamId}/library/suggestions`, { title: "opening prayer", hidden: true });
    expect((await ada.get(`/api/teams/${teamId}/agenda-suggestions?q=open`)).json.suggestions).toEqual([]);
    await ada.request("PUT", `/api/teams/${teamId}/library/templates`, { eventId: id, pinned: true });
    expect((await ada.get(`/api/teams/${teamId}/templates`)).json.templates[0]).toMatchObject({ eventId: id, pinned: true });
  });

  it("serves the team's logo publicly, and only images", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    expect((await ada.request("PATCH", `/api/teams/${teamId}/settings`, { logo: "data:text/html;base64,PGgxPg==" })).status).toBe(400);
    await ada.request("PATCH", `/api/teams/${teamId}/settings`, { logo: png });
    const res = await new Browser(t.env).get(`/api/teams/${teamId}/logo`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });
});

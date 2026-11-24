import { beforeEach, describe, expect, it } from "vitest";
import { NOTIFY_DELAY_MS } from "../src/live/changes";
import { runCommand } from "../src/live/commands";
import { sendEmail } from "../src/mail";
import { Browser, ORIGIN, createTestEnv, tokenFromEmail } from "./helpers/client";

let t: ReturnType<typeof createTestEnv>;
let ada: Browser; // Approver
let teamId: string;
let eventId: string;
let chi: { browser: Browser; userId: string; participant: string };
let dayo: { browser: Browser; userId: string; participant: string };
let guest: string;
let opening: string;
let keynote: string;

// 2030-06-01 09:00 UTC = 10:00 in Lagos.
const START = "2030-06-01T09:00:00.000Z";
const END = "2030-06-01T12:00:00.000Z";

async function person(first: string, email: string): Promise<Browser> {
  const b = new Browser(t.env);
  await b.post("/api/auth/signup", { firstName: first, lastName: "Test", email, password: "correct horse battery" });
  await b.post("/api/auth/verify-email", { token: tokenFromEmail(t.emails.at(-1)) });
  return b;
}

async function member(first: string, email: string) {
  await ada.post(`/api/teams/${teamId}/invites`, { email, role: "member" });
  const invite = t.emails.at(-1)!.text.match(/\/invite\/([A-Za-z0-9_-]+)/)![1];
  const browser = await person(first, email);
  await browser.post(`/api/invites/${invite}/accept`);
  const userId = (await browser.get("/api/auth/me")).json.user.id as string;
  const participant = (await ada.post(`/api/events/${eventId}/participants`, { userId })).json.participantId as string;
  return { browser, userId, participant };
}

const hooks = () => ({ appOrigin: ORIGIN, send: (e: Parameters<typeof sendEmail>[1]) => sendEmail(t.env, e) });
const notifyAt = () => {
  const row = t.sqlite.prepare("SELECT notify_after FROM events WHERE id = ?").get(eventId) as { notify_after: string | null };
  return row.notify_after ? Date.parse(row.notify_after) : null;
};
/** Let the 2-minute quiet period pass, as the live room's alarm would. */
async function quietPeriodPasses() {
  const due = notifyAt();
  if (!due) return 0;
  return (await runCommand(t.env.DB, eventId, { action: "tick", by: null }, due + 1, hooks())).noticesSent;
}
const emailsTo = (to: string) => t.emails.filter((e) => e.to === to);

beforeEach(async () => {
  t = createTestEnv();
  ada = await person("Ada", "ada@example.com");
  const adaId = (await ada.get("/api/auth/me")).json.user.id;
  teamId = (await ada.post("/api/teams", { name: "Events Team" })).json.team.id;
  eventId = (await ada.post(`/api/teams/${teamId}/events`, { name: "AGM", startAt: START, endAt: END, timezone: "Africa/Lagos" })).json.event.id;
  chi = await member("Chi", "chi@example.com");
  dayo = await member("Dayo", "dayo@example.com");
  guest = (await ada.post(`/api/events/${eventId}/participants`, { guestName: "Funmi", guestEmail: "funmi@example.com" })).json.participantId;
  opening = (await ada.post(`/api/events/${eventId}/tasks`, { title: "Opening", durationMinutes: 10, assigneeIds: [chi.participant] })).json.taskId;
  keynote = (await ada.post(`/api/events/${eventId}/tasks`, { title: "Keynote", durationMinutes: 30, assigneeIds: [guest] })).json.taskId;
  await ada.post(`/api/events/${eventId}/tasks`, { title: "Close", durationMinutes: 10, assigneeIds: [dayo.participant] });
  await ada.post(`/api/events/${eventId}/submit`, { approverIds: [adaId] });
  await ada.post(`/api/events/${eventId}/approve`);
});

describe("editing an approved event", () => {
  it("is allowed, and the plan stays approved", async () => {
    const res = await ada.request("PATCH", `/api/events/${eventId}/tasks/${opening}`, { durationMinutes: 20 });
    expect(res.status).toBe(200);
    expect(res.json.event.status).toBe("approved");
    expect(res.json.permissions.canEdit).toBe(true);
  });

  it("isn't allowed for Members", async () => {
    expect((await chi.browser.request("PATCH", `/api/events/${eventId}/tasks/${opening}`, { durationMinutes: 20 })).status).toBe(403);
  });

  it("can't delete an approved event", async () => {
    expect((await ada.request("DELETE", `/api/events/${eventId}`)).status).toBe(409);
  });

  it("waits 2 minutes after the last change before notifying", async () => {
    const before = t.emails.length;
    const t0 = Date.now();
    await ada.request("PATCH", `/api/events/${eventId}/tasks/${opening}`, { durationMinutes: 20 });
    const due = notifyAt()!;
    expect(due - t0).toBeGreaterThanOrEqual(NOTIFY_DELAY_MS - 1000);
    expect(due - t0).toBeLessThanOrEqual(NOTIFY_DELAY_MS + 1000);
    // The live room will wake for it.
    expect((t.env.LIVE_EVENT as unknown as { alarms: Map<string, number> }).alarms.get(eventId)).toBe(due);
    expect(t.emails.length).toBe(before); // nothing yet
  });

  it("notifies only the people whose part changed, in one email each", async () => {
    // Opening gets longer: Opening (Chi) is unchanged at 10:00, but Keynote (guest) and Close (Dayo) move.
    await ada.request("PATCH", `/api/events/${eventId}/tasks/${opening}`, { durationMinutes: 15 });
    await ada.request("PATCH", `/api/events/${eventId}/tasks/${opening}`, { durationMinutes: 20 }); // a second quick edit
    const before = t.emails.length;
    expect(await quietPeriodPasses()).toBe(2);

    const sent = t.emails.slice(before);
    expect(sent.map((e) => e.to).sort()).toEqual(["dayo@example.com", "funmi@example.com"]);
    const dayoMail = emailsTo("dayo@example.com").at(-1)!;
    expect(dayoMail.subject).toBe("Changes to the program: AGM");
    expect(dayoMail.text).toContain("10:50 AM  Close"); // now
    expect(dayoMail.text).toContain("Before the change: 10:40 AM  Close");

    // A guest's change email carries a fresh personal link that works; the old one is replaced.
    const link = emailsTo("funmi@example.com").at(-1)!.text.match(/\/g\/([A-Za-z0-9_-]+)/)![1];
    const page = await new Browser(t.env).get(`/api/guest/${link}`);
    expect(page.json.program.find((x: { title: string }) => x.title === "Keynote").startAt).toBe("2030-06-01T09:20:00.000Z");

    // Nothing more to send.
    expect(await quietPeriodPasses()).toBe(0);
  });

  it("tells newly added and removed people", async () => {
    const newGuest = (await ada.post(`/api/events/${eventId}/participants`, { guestName: "Emeka", guestEmail: "emeka@example.com" })).json.participantId;
    await ada.request("PATCH", `/api/events/${eventId}/tasks/${keynote}`, { assigneeIds: [newGuest] });
    await ada.request("DELETE", `/api/events/${eventId}/participants/${dayo.participant}`);
    const before = t.emails.length;
    await quietPeriodPasses();
    const sent = t.emails.slice(before);

    const emeka = sent.find((e) => e.to === "emeka@example.com")!;
    expect(emeka.subject).toBe("You're on the program: AGM");
    expect(emeka.text).toMatch(/\/g\/[A-Za-z0-9_-]{40,}/);
    expect(sent.find((e) => e.to === "dayo@example.com")!.subject).toBe("You're no longer on the program: AGM");
    // Funmi lost the keynote, so her part changed.
    expect(sent.find((e) => e.to === "funmi@example.com")!.text).toContain("No tasks at the moment");
    // Chi's part didn't change.
    expect(sent.some((e) => e.to === "chi@example.com")).toBe(false);
  });

  it("tells everyone when the event moves", async () => {
    const endBefore = (await ada.get(`/api/events/${eventId}`)).json.event.endAt as string;
    await ada.request("PATCH", `/api/events/${eventId}`, { startAt: "2030-06-01T10:00:00.000Z" });
    const endAfter = new Date(Date.parse(endBefore) + 3_600_000).toISOString();
    const before = t.emails.length;
    await quietPeriodPasses();
    expect(t.emails.slice(before).map((e) => e.to).sort()).toEqual(["chi@example.com", "dayo@example.com", "funmi@example.com"]);
    // Guest links now expire at the new end time.
    const links = t.sqlite.prepare("SELECT expires_at FROM guest_access_links WHERE revoked_at IS NULL").all() as { expires_at: string }[];
    expect(links.every((l) => l.expires_at === endAfter)).toBe(true);
  });

  it("replaced guest links explain where to find the new one", async () => {
    const original = t.emails.filter((e) => e.to === "funmi@example.com").at(-1)!.text.match(/\/g\/([A-Za-z0-9_-]+)/)![1];
    await ada.request("PATCH", `/api/events/${eventId}/tasks/${opening}`, { durationMinutes: 20 });
    await quietPeriodPasses();
    const res = await new Browser(t.env).get(`/api/guest/${original}`);
    expect(res.json.code).toBe("link_replaced");
  });

  it("changes during review aren't possible, so nothing is queued", async () => {
    // (approved here; move a fresh draft into review to check)
    const draft = (await ada.post(`/api/teams/${teamId}/events`, { name: "Other", startAt: START, endAt: END, timezone: "UTC" })).json.event.id;
    await ada.post(`/api/events/${draft}/tasks`, { title: "X", durationMinutes: 5 });
    const adaId = (await ada.get("/api/auth/me")).json.user.id;
    await ada.post(`/api/events/${draft}/submit`, { approverIds: [adaId] });
    expect((await ada.post(`/api/events/${draft}/tasks`, { title: "Y", durationMinutes: 5 })).json.code).toBe("event_in_review");
  });
});

describe("editing a live event", () => {
  beforeEach(async () => {
    await ada.post(`/api/events/${eventId}/live/start`);
  });

  it("can't change finished or started tasks' place, or the start time", async () => {
    await ada.post(`/api/events/${eventId}/live/next`); // Opening done, Keynote in progress
    expect((await ada.request("PATCH", `/api/events/${eventId}/tasks/${opening}`, { title: "Changed" })).json.code).toBe("task_finished");
    expect((await ada.request("DELETE", `/api/events/${eventId}/tasks/${keynote}`)).json.code).toBe("task_started");
    const tasks = (await ada.get(`/api/events/${eventId}`)).json.tasks.map((x: { id: string }) => x.id);
    expect((await ada.request("PUT", `/api/events/${eventId}/tasks/order`, { taskIds: [tasks[1], tasks[0], tasks[2]] })).json.code).toBe("task_started");
    expect((await ada.request("PATCH", `/api/events/${eventId}`, { startAt: "2030-06-01T08:00:00.000Z" })).status).toBe(409);
  });

  it("can extend the current task and add tasks, and people are notified", async () => {
    const res = await ada.request("PATCH", `/api/events/${eventId}/tasks/${opening}`, { durationMinutes: 25 });
    expect(res.status).toBe(200);
    expect((await ada.post(`/api/events/${eventId}/tasks`, { title: "Award", durationMinutes: 5, assigneeIds: [chi.participant] })).status).toBe(201);
    const before = t.emails.length;
    await quietPeriodPasses();
    const sent = t.emails.slice(before).map((e) => e.to).sort();
    expect(sent).toContain("chi@example.com"); // gained the award
    expect(sent).toContain("dayo@example.com"); // Close moved later
  });
});

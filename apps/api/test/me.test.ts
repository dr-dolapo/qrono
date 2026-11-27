import { beforeEach, describe, expect, it } from "vitest";
import { Browser, createTestEnv, tokenFromEmail } from "./helpers/client";

let t: ReturnType<typeof createTestEnv>;
let teamId: string;
let ada: Browser; // Admin who creates the team
let adaId: string;

const base = { startAt: "2026-12-01T09:00:00.000Z", endAt: "2026-12-01T12:00:00.000Z", timezone: "Africa/Lagos" };

async function person(first: string, email: string): Promise<Browser> {
  const b = new Browser(t.env);
  await b.post("/api/auth/signup", { firstName: first, lastName: "Test", email, password: "correct horse battery" });
  await b.post("/api/auth/verify-email", { token: tokenFromEmail(t.emails.at(-1)) });
  return b;
}

async function joinTeam(first: string, email: string): Promise<{ browser: Browser; userId: string }> {
  await ada.post(`/api/teams/${teamId}/invites`, { email, role: "member" });
  const token = t.emails.at(-1)!.text.match(/\/invite\/([A-Za-z0-9_-]+)/)![1];
  const browser = await person(first, email);
  await browser.post(`/api/invites/${token}/accept`);
  return { browser, userId: (await browser.get("/api/auth/me")).json.user.id };
}

async function createEvent(name: string, startAt = base.startAt, endAt = base.endAt): Promise<string> {
  const res = await ada.post(`/api/teams/${teamId}/events`, { ...base, name, startAt, endAt });
  return res.json.event.id;
}

async function addParticipant(eventId: string, userId: string): Promise<string> {
  return (await ada.post(`/api/events/${eventId}/participants`, { userId })).json.participantId;
}

beforeEach(async () => {
  t = createTestEnv();
  ada = await person("Ada", "ada@example.com");
  adaId = (await ada.get("/api/auth/me")).json.user.id;
  teamId = (await ada.post("/api/teams", { name: "Events Team" })).json.team.id;
});

describe("GET /api/me/events", () => {
  it("lists only the events I'm a participant in, with my tasks", async () => {
    const bola = await joinTeam("Bola", "bola@example.com");
    const agm = await createEvent("AGM");
    await createEvent("Board meeting"); // Bola isn't in this one
    const pid = await addParticipant(agm, bola.userId);
    await ada.post(`/api/events/${agm}/tasks`, { title: "Opening", durationMinutes: 10, who: [{ userId: adaId }] });
    await ada.post(`/api/events/${agm}/tasks`, { title: "Keynote", durationMinutes: 30, assigneeIds: [pid] });
    await ada.post(`/api/events/${agm}/tasks`, { title: "Q&A", durationMinutes: 15, assigneeIds: [pid] });

    const res = await bola.browser.get("/api/me/events");
    expect(res.status).toBe(200);
    expect(res.json.events).toHaveLength(1);
    expect(res.json.events[0]).toMatchObject({
      id: agm,
      name: "AGM",
      team: { id: teamId, name: "Events Team" },
      status: "draft",
      timezone: "Africa/Lagos",
      myResponse: "acknowledged",
      myTaskCount: 2,
      myNextTask: { title: "Keynote", startAt: "2026-12-01T09:10:00.000Z" },
      awaitingMyApproval: false,
    });
  });

  it("skips finished tasks when picking my next one", async () => {
    const bola = await joinTeam("Bola", "bola@example.com");
    const agm = await createEvent("AGM");
    const pid = await addParticipant(agm, bola.userId);
    await ada.post(`/api/events/${agm}/tasks`, { title: "Keynote", durationMinutes: 30, assigneeIds: [pid] });
    await ada.post(`/api/events/${agm}/tasks`, { title: "Q&A", durationMinutes: 15, assigneeIds: [pid] });
    t.sqlite.prepare("UPDATE tasks SET status = 'done' WHERE title = 'Keynote'").run();
    expect((await bola.browser.get("/api/me/events")).json.events[0].myNextTask.title).toBe("Q&A");
  });

  it("lists events sorted by start time, across all my teams", async () => {
    const bola = await joinTeam("Bola", "bola@example.com");
    const later = await createEvent("Later", "2026-12-05T09:00:00.000Z", "2026-12-05T10:00:00.000Z");
    const sooner = await createEvent("Sooner");
    await addParticipant(later, bola.userId);
    await addParticipant(sooner, bola.userId);

    const other = await bola.browser.post("/api/teams", { name: "Bola's Team" });
    const own = await bola.browser.post(`/api/teams/${other.json.team.id}/events`, { ...base, name: "Own", startAt: "2026-12-03T09:00:00.000Z", endAt: "2026-12-03T10:00:00.000Z" });
    await bola.browser.post(`/api/events/${own.json.event.id}/participants`, { userId: bola.userId });

    const names = (await bola.browser.get("/api/me/events")).json.events.map((e: { name: string }) => e.name);
    expect(names).toEqual(["Sooner", "Own", "Later"]);
  });

  it("includes events waiting for my approval, even when I'm not a participant", async () => {
    const agm = await createEvent("AGM");
    // Run by a guest, so Ada isn't on the program herself.
    const guest = (await ada.post(`/api/events/${agm}/participants`, { guestName: "Funmi", guestEmail: "funmi@example.com" })).json.participantId;
    await ada.post(`/api/events/${agm}/tasks`, { title: "Opening", durationMinutes: 10, assigneeIds: [guest] });
    await ada.post(`/api/events/${agm}/submit`, { approverIds: [adaId] });

    const [event] = (await ada.get("/api/me/events")).json.events;
    expect(event).toMatchObject({ id: agm, status: "review", awaitingMyApproval: true, myResponse: null, myTaskCount: 0, myNextTask: null });

    await ada.post(`/api/events/${agm}/approve`);
    expect((await ada.get("/api/me/events")).json.events).toHaveLength(0);
  });

  it("drops events from a team I've been removed from", async () => {
    const bola = await joinTeam("Bola", "bola@example.com");
    const agm = await createEvent("AGM");
    await addParticipant(agm, bola.userId);
    t.sqlite.prepare("UPDATE team_memberships SET status = 'removed' WHERE user_id = ?").run(bola.userId);
    expect((await bola.browser.get("/api/me/events")).json.events).toHaveLength(0);
  });

  it("needs a verified login", async () => {
    expect((await new Browser(t.env).get("/api/me/events")).status).toBe(401);
  });
});

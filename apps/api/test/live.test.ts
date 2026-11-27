import { beforeEach, describe, expect, it } from "vitest";
import { Browser, createTestEnv, tokenFromEmail } from "./helpers/client";

let t: ReturnType<typeof createTestEnv>;
let ada: Browser; // Admin
let chi: Browser; // Member on the program
let eventId: string;

// An event far in the future, so nothing goes live by itself during the test.
const START = "2030-06-01T09:00:00.000Z";
const END = "2030-06-01T11:00:00.000Z";

async function person(first: string, email: string): Promise<Browser> {
  const b = new Browser(t.env);
  await b.post("/api/auth/signup", { firstName: first, lastName: "Test", email, password: "correct horse battery" });
  await b.post("/api/auth/verify-email", { token: tokenFromEmail(t.emails.at(-1)) });
  return b;
}

beforeEach(async () => {
  t = createTestEnv();
  ada = await person("Ada", "ada@example.com");
  const adaId = (await ada.get("/api/auth/me")).json.user.id;
  const teamId = (await ada.post("/api/teams", { name: "Events Team" })).json.team.id;
  await ada.post(`/api/teams/${teamId}/invites`, { email: "chi@example.com", role: "member" });
  const invite = t.emails.at(-1)!.text.match(/\/invite\/([A-Za-z0-9_-]+)/)![1];
  chi = await person("Chi", "chi@example.com");
  await chi.post(`/api/invites/${invite}/accept`);
  const chiId = (await chi.get("/api/auth/me")).json.user.id;

  eventId = (await ada.post(`/api/teams/${teamId}/events`, { name: "AGM", startAt: START, endAt: END, timezone: "Africa/Lagos" })).json.event.id;
  const p = (await ada.post(`/api/events/${eventId}/participants`, { userId: chiId })).json.participantId;
  await ada.post(`/api/events/${eventId}/tasks`, { title: "Opening", durationMinutes: 5, assigneeIds: [p] });
  await ada.post(`/api/events/${eventId}/tasks`, { title: "Keynote", durationMinutes: 30, who: [{ userId: adaId }] });
  await ada.post(`/api/events/${eventId}/submit`, { approverIds: [adaId] });
});

const approve = () => ada.post(`/api/events/${eventId}/approve`);
const alarms = () => (t.env.LIVE_EVENT as unknown as { alarms: Map<string, number | null> }).alarms;

describe("running an event live", () => {
  it("approval arms the live room for the start time", async () => {
    await approve();
    expect(alarms().get(eventId)).toBe(Date.parse(START));
    expect((await ada.get(`/api/events/${eventId}`)).json.permissions.canRunLive).toBe(true);
  });

  it("can't start before approval", async () => {
    const res = await ada.post(`/api/events/${eventId}/live/start`);
    expect(res.status).toBe(409);
  });

  it("a Planner starts early, moves on, and ends the event", async () => {
    await approve();
    let state = (await ada.post(`/api/events/${eventId}/live/start`)).json;
    expect(state.event.status).toBe("live");
    expect(state.tasks[0]).toMatchObject({ title: "Opening", status: "in_progress", assignees: ["Chi Test"] });
    expect(state.currentTaskId).toBe(state.tasks[0].id);

    state = (await ada.post(`/api/events/${eventId}/live/next`)).json;
    expect(state.tasks.map((x: { status: string }) => x.status)).toEqual(["done", "in_progress"]);

    state = (await ada.post(`/api/events/${eventId}/live/end`)).json;
    expect(state.event.status).toBe("past");
    expect(state.event.endedEarlyAt).toBeTruthy();
    expect(alarms().get(eventId)).toBeNull();

    const detail = await ada.get(`/api/events/${eventId}`);
    expect(detail.json.event.status).toBe("past");
    expect(detail.json.permissions.canRunLive).toBe(false);
  });

  it("a skip can be undone straight after, and only then", async () => {
    await approve();
    await ada.post(`/api/events/${eventId}/live/start`);
    const before = (await ada.post(`/api/events/${eventId}/live/next`)).json;
    let state = (await ada.post(`/api/events/${eventId}/live/undo`)).json;
    expect(state.tasks.map((x: { status: string }) => x.status)).toEqual(["in_progress", "upcoming"]);
    expect(state.currentTaskId).toBe(state.tasks[0].id);
    // Opening carries on from when it really started; Keynote hasn't started.
    expect(state.tasks[0].actualStartAt).toBe(before.tasks[0].actualStartAt);
    expect(state.tasks[1].actualStartAt).toBeNull();
    // Nothing more to undo.
    expect((await ada.post(`/api/events/${eventId}/live/undo`)).status).toBe(409);

    // Too late: the skip was a minute ago.
    state = (await ada.post(`/api/events/${eventId}/live/next`)).json;
    const minuteAgo = new Date(Date.now() - 60_000).toISOString();
    t.sqlite.prepare("UPDATE tasks SET actual_end_at = ? WHERE id = ?").run(minuteAgo, state.tasks[0].id);
    t.sqlite.prepare("UPDATE tasks SET actual_start_at = ? WHERE id = ?").run(minuteAgo, state.tasks[1].id);
    const late = await ada.post(`/api/events/${eventId}/live/undo`);
    expect(late.status).toBe(409);
    expect(late.json.error).toMatch(/too late/i);
    // Members can't.
    expect((await chi.post(`/api/events/${eventId}/live/undo`)).status).toBe(403);
  });

  it("an Admin or Planner can delete a past event; nobody is told, and it leaves everyone's list", async () => {
    await approve();
    // Not while it's coming up or live.
    expect((await ada.request("DELETE", `/api/events/${eventId}`)).status).toBe(409);
    await ada.post(`/api/events/${eventId}/live/start`);
    await ada.post(`/api/events/${eventId}/live/end`);
    expect((await ada.get(`/api/events/${eventId}`)).json.permissions.canDelete).toBe(true);
    expect((await chi.get(`/api/events/${eventId}`)).json.permissions.canDelete).toBe(false);
    // A member taking part can't.
    expect((await chi.request("DELETE", `/api/events/${eventId}`)).status).toBe(403);

    const emailsBefore = t.emails.length;
    expect((await ada.request("DELETE", `/api/events/${eventId}`)).status).toBe(200);
    expect(t.emails.length).toBe(emailsBefore);
    expect((await chi.get(`/api/events/${eventId}`)).status).toBe(404);
    const list = (await chi.get("/api/me/events")).json.events as { id: string }[];
    expect(list.some((e) => e.id === eventId)).toBe(false);
  });

  it("participants can't control the event", async () => {
    await approve();
    expect((await chi.post(`/api/events/${eventId}/live/start`)).status).toBe(403);
    expect((await chi.get(`/api/events/${eventId}`)).json.permissions.canRunLive).toBe(false);
  });

  it("rejects unknown actions", async () => {
    await approve();
    expect((await ada.post(`/api/events/${eventId}/live/skip-everything`)).status).toBe(404);
  });

  it("blocks the live socket from other sites", async () => {
    await approve();
    const res = await ada.request("GET", `/api/events/${eventId}/live`, undefined, { Upgrade: "websocket", Origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("lets the mobile app open the live socket with its token, whatever Origin it sends", async () => {
    await approve();
    const login = await new Browser(t.env).request(
      "POST",
      "/api/auth/login",
      { email: "chi@example.com", password: "correct horse battery" },
      { "X-Qrono-Client": "mobile" },
    );
    const phone = new Browser(t.env);
    const headers = { Upgrade: "websocket", Origin: "https://app.example", Authorization: `Bearer ${login.json.session.token}` };
    // 501 = the request reached the live room (the test double doesn't simulate WebSockets).
    expect((await phone.request("GET", `/api/events/${eventId}/live`, undefined, headers)).status).toBe(501);
    // A made-up token isn't let through.
    expect((await phone.request("GET", `/api/events/${eventId}/live`, undefined, { ...headers, Authorization: `Bearer ${"x".repeat(43)}` })).status).toBe(401);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { Browser, createTestEnv, tokenFromEmail } from "./helpers/client";

let t: ReturnType<typeof createTestEnv>;
let teamId: string;
let ada: Browser; // Admin

const START = "2026-12-01T09:00:00.000Z";
const base = { name: "Annual General Meeting", startAt: START, timezone: "Africa/Lagos" };

async function person(first: string, email: string): Promise<Browser> {
  const b = new Browser(t.env);
  await b.post("/api/auth/signup", { firstName: first, lastName: "Test", email, password: "correct horse battery" });
  await b.post("/api/auth/verify-email", { token: tokenFromEmail(t.emails.at(-1)) });
  return b;
}

async function joinTeam(first: string, email: string, role: "admin" | "member"): Promise<{ browser: Browser; userId: string }> {
  await ada.post(`/api/teams/${teamId}/invites`, { email, role });
  const token = t.emails.at(-1)!.text.match(/\/invite\/([A-Za-z0-9_-]+)/)![1];
  const browser = await person(first, email);
  await browser.post(`/api/invites/${token}/accept`);
  const me = await browser.get("/api/auth/me");
  return { browser, userId: me.json.user.id };
}

async function createEvent(body: object = base): Promise<string> {
  const res = await ada.post(`/api/teams/${teamId}/events`, body);
  expect(res.status).toBe(201);
  return res.json.event.id;
}

beforeEach(async () => {
  t = createTestEnv();
  ada = await person("Ada", "ada@example.com");
  teamId = (await ada.post("/api/teams", { name: "Events Team" })).json.team.id;
});

describe("creating and editing events (QR019, QR020, QR022)", () => {
  it("creates a draft with manual progression by default", async () => {
    const id = await createEvent();
    const res = await ada.get(`/api/events/${id}`);
    // No agenda yet, so it "ends" a minute after it starts.
    expect(res.json.event).toMatchObject({ name: base.name, status: "draft", progressionMode: "manual", startAt: START, endAt: "2026-12-01T09:01:00.000Z", timezone: "Africa/Lagos" });
    expect(res.json.permissions).toMatchObject({ canEdit: true, canManage: true });
    const log = t.sqlite.prepare("SELECT from_status, to_status FROM event_status_changes WHERE event_id = ?").all(id);
    expect(log).toEqual([{ from_status: null, to_status: "draft" }]);
  });

  it("uses the team's time zone unless told otherwise", async () => {
    await ada.request("PATCH", `/api/teams/${teamId}/settings`, { timezone: "Europe/London" });
    const id = await createEvent({ name: "Carol Service", startAt: START });
    expect((await ada.get(`/api/events/${id}`)).json.event.timezone).toBe("Europe/London");
  });

  it("lets only Admins and Planners change team settings", async () => {
    const member = await joinTeam("Chi", "chi@example.com", "member");
    expect((await member.browser.get(`/api/teams/${teamId}/settings`)).json).toMatchObject({ settings: null, canEdit: false });
    expect((await member.browser.request("PATCH", `/api/teams/${teamId}/settings`, { timezone: "Africa/Lagos" })).status).toBe(403);
    expect((await ada.request("PATCH", `/api/teams/${teamId}/settings`, { timezone: "Mars/Olympus" })).json.fields.timezone).toBe("Choose a valid time zone.");
    expect((await ada.request("PATCH", `/api/teams/${teamId}/settings`, { timezone: "Africa/Lagos" })).json.settings.timezone).toBe("Africa/Lagos");
  });

  it("validates the start and time zone", async () => {
    const res = await ada.post(`/api/teams/${teamId}/events`, { ...base, startAt: "2026-12-01T09:10:00.000Z" });
    expect(res.status).toBe(400);
    expect(res.json.fields.startAt).toBe("Choose a start time on the hour or at :15, :30 or :45.");

    const past = await ada.post(`/api/teams/${teamId}/events`, { ...base, startAt: "2020-01-01T09:00:00.000Z" });
    expect(past.json.fields.startAt).toBe("Choose a time from now on.");

    const tz = await ada.post(`/api/teams/${teamId}/events`, { ...base, timezone: "Mars/Olympus" });
    expect(tz.json.fields.timezone).toBe("Choose a valid time zone.");

    const date = await ada.post(`/api/teams/${teamId}/events`, { ...base, startAt: "tomorrow" });
    expect(date.json.fields.startAt).toBe("Choose a valid date and time.");
  });

  it("edits details and keeps the times consistent", async () => {
    const id = await createEvent();
    const res = await ada.request("PATCH", `/api/events/${id}`, { name: "AGM 2026", progressionMode: "auto" });
    expect(res.json.event).toMatchObject({ name: "AGM 2026", progressionMode: "auto" });
    const bad = await ada.request("PATCH", `/api/events/${id}`, { startAt: "2026-12-01T08:20:00.000Z" });
    expect(bad.status).toBe(400);

    // Moving the start moves the whole agenda, and the end with it.
    await ada.post(`/api/events/${id}/tasks`, { title: "Opening", durationMinutes: 30 });
    const moved = (await ada.request("PATCH", `/api/events/${id}`, { startAt: "2026-12-01T10:00:00.000Z" })).json;
    expect(moved.tasks[0].startAt).toBe("2026-12-01T10:00:00.000Z");
    expect(moved.event.endAt).toBe("2026-12-01T10:30:00.000Z");
  });

  it("locks the plan while the event is in review", async () => {
    const id = await createEvent();
    t.sqlite.prepare("UPDATE events SET status = 'review' WHERE id = ?").run(id);
    const res = await ada.request("PATCH", `/api/events/${id}`, { name: "Changed" });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("event_in_review");
    expect((await ada.post(`/api/events/${id}/tasks`, { title: "X", durationMinutes: 5 })).status).toBe(409);
    expect((await ada.get(`/api/events/${id}`)).json.permissions.canEdit).toBe(false);
  });

  it("deletes a draft and everything in it", async () => {
    const id = await createEvent();
    await ada.post(`/api/events/${id}/tasks`, { title: "Opening", durationMinutes: 5 });
    expect((await ada.request("DELETE", `/api/events/${id}`)).status).toBe(200);
    expect((await ada.get(`/api/events/${id}`)).status).toBe(404);
    expect(t.sqlite.prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 0 });
  });
});

describe("who can see and change events", () => {
  it("lets Planners create and edit, but not Members", async () => {
    const admin = await joinTeam("Bola", "bola@example.com", "admin");
    expect((await admin.browser.post(`/api/teams/${teamId}/events`, base)).status).toBe(201);
    const member = await joinTeam("Chi", "chi@example.com", "member");
    expect((await member.browser.post(`/api/teams/${teamId}/events`, base)).status).toBe(403);
  });

  it("shows Members only the events they're in, read-only", async () => {
    const member = await joinTeam("Chi", "chi@example.com", "member");
    const visible = await createEvent();
    await createEvent({ ...base, name: "Board dinner" });
    await ada.post(`/api/events/${visible}/participants`, { userId: member.userId });

    const list = await member.browser.get(`/api/teams/${teamId}/events`);
    expect(list.json.canCreate).toBe(false);
    expect(list.json.events.map((e: { id: string }) => e.id)).toEqual([visible]);

    const detail = await member.browser.get(`/api/events/${visible}`);
    expect(detail.json.permissions).toMatchObject({ canEdit: false, canManage: false });
    expect((await member.browser.request("PATCH", `/api/events/${visible}`, { name: "Mine now" })).status).toBe(403);
  });

  it("hides events from people outside the team", async () => {
    const id = await createEvent();
    const outsider = await person("Eve", "eve@example.com");
    expect((await outsider.get(`/api/events/${id}`)).status).toBe(404);
    expect((await outsider.get(`/api/teams/${teamId}/events`)).status).toBe(404);
  });
});

describe("agenda (stages, tasks, timing)", () => {
  it("times tasks back to back and recomputes when they move", async () => {
    const id = await createEvent();
    const opening = (await ada.post(`/api/events/${id}/tasks`, { title: "Opening", durationMinutes: 5 })).json.taskId;
    await ada.post(`/api/events/${id}/tasks`, { title: "Introductions", durationMinutes: 15 });
    const keynote = (await ada.post(`/api/events/${id}/tasks`, { title: "Keynote", durationMinutes: 35 })).json.taskId;

    let detail = (await ada.get(`/api/events/${id}`)).json;
    expect(detail.tasks.map((x: { title: string; startAt: string }) => [x.title, x.startAt.slice(11, 16)])).toEqual([
      ["Opening", "09:00"],
      ["Introductions", "09:05"],
      ["Keynote", "09:20"],
    ]);
    expect(detail.schedule).toEqual({ endsAt: "2026-12-01T09:55:00.000Z", overrunMinutes: 0 });

    // Move the keynote first.
    const intro = detail.tasks[1].id;
    detail = (await ada.request("PUT", `/api/events/${id}/tasks/order`, { taskIds: [keynote, opening, intro] })).json;
    expect(detail.tasks.map((x: { title: string; startAt: string }) => [x.title, x.startAt.slice(11, 16)])).toEqual([
      ["Keynote", "09:00"],
      ["Opening", "09:35"],
      ["Introductions", "09:40"],
    ]);
    // Stored start times follow too.
    const stored = t.sqlite.prepare("SELECT planned_start_at FROM tasks WHERE id = ?").get(opening) as { planned_start_at: string };
    expect(stored.planned_start_at).toBe("2026-12-01T09:35:00.000Z");

    // Moving the event moves the agenda.
    detail = (await ada.request("PATCH", `/api/events/${id}`, { startAt: "2026-12-01T10:00:00.000Z" })).json;
    expect(detail.tasks[0].startAt).toBe("2026-12-01T10:00:00.000Z");
  });

  it("ends when the agenda does", async () => {
    const id = await createEvent();
    await ada.post(`/api/events/${id}/tasks`, { title: "Welcome", durationMinutes: 15 });
    let detail = (await ada.post(`/api/events/${id}/tasks`, { title: "Long keynote", durationMinutes: 45 })).json;
    expect(detail.event.endAt).toBe("2026-12-01T10:00:00.000Z");
    expect(detail.schedule.overrunMinutes).toBe(0);

    detail = (await ada.request("DELETE", `/api/events/${id}/tasks/${detail.tasks[1].id}`)).json;
    expect(detail.event.endAt).toBe("2026-12-01T09:15:00.000Z");
  });

  it("runs breakouts on separate stages side by side", async () => {
    const id = await createEvent();
    let detail = (await ada.post(`/api/events/${id}/stages`, { name: "Adire Hall", venue: "Radisson Blu" })).json;
    detail = (await ada.post(`/api/events/${id}/stages`, { name: "Ankara Hall" })).json;
    const [hallA, hallB] = detail.stages.map((s: { id: string }) => s.id);

    await ada.post(`/api/events/${id}/tasks`, { title: "Opening", durationMinutes: 10, stageId: null });
    await ada.post(`/api/events/${id}/tasks`, { title: "Break-out I", durationMinutes: 40, stageId: hallA });
    await ada.post(`/api/events/${id}/tasks`, { title: "Break-out II", durationMinutes: 30, stageId: hallB });
    detail = (await ada.post(`/api/events/${id}/tasks`, { title: "Conclusions", durationMinutes: 15, stageId: null })).json;

    expect(detail.tasks.map((x: { title: string; startAt: string }) => [x.title, x.startAt.slice(11, 16)])).toEqual([
      ["Opening", "09:00"],
      ["Break-out I", "09:10"],
      ["Break-out II", "09:10"],
      ["Conclusions", "09:50"],
    ]);
  });

  it("won't delete a stage that still has tasks", async () => {
    const id = await createEvent();
    const stage = (await ada.post(`/api/events/${id}/stages`, { name: "Adire Hall" })).json.stages[0].id;
    const task = (await ada.post(`/api/events/${id}/tasks`, { title: "Talk", durationMinutes: 20, stageId: stage })).json.taskId;
    const res = await ada.request("DELETE", `/api/events/${id}/stages/${stage}`);
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("stage_in_use");

    await ada.request("PATCH", `/api/events/${id}/tasks/${task}`, { stageId: null });
    expect((await ada.request("DELETE", `/api/events/${id}/stages/${stage}`)).status).toBe(200);
  });

  it("rejects a stage from another event", async () => {
    const a = await createEvent();
    const b = await createEvent({ ...base, name: "Other" });
    const stage = (await ada.post(`/api/events/${b}/stages`, { name: "Elsewhere" })).json.stages[0].id;
    const res = await ada.post(`/api/events/${a}/tasks`, { title: "X", durationMinutes: 5, stageId: stage });
    expect(res.status).toBe(400);
    expect(res.json.fields.stageId).toBeDefined();
  });

  it("only accepts durations from the editor's list", async () => {
    const id = await createEvent();
    const expectRejected = async (durationMinutes: number) => {
      const res = await ada.post(`/api/events/${id}/tasks`, { title: "Item", durationMinutes });
      expect(res.status).toBe(400);
      expect(res.json.fields.durationMinutes).toMatch(/Choose a duration from the list/);
    };
    // 1–15 by 1, 20–60 by 5, 75–120 by 15.
    for (const ok of [1, 7, 15, 20, 35, 60, 75, 120]) {
      expect((await ada.post(`/api/events/${id}/tasks`, { title: `${ok} min`, durationMinutes: ok })).status).toBe(201);
    }
    for (const bad of [0, 16, 17, 62, 70, 135, 150]) await expectRejected(bad);
  });

  it("rejects a stale reorder", async () => {
    const id = await createEvent();
    const one = (await ada.post(`/api/events/${id}/tasks`, { title: "One", durationMinutes: 5 })).json.taskId;
    await ada.post(`/api/events/${id}/tasks`, { title: "Two", durationMinutes: 5 });
    const res = await ada.request("PUT", `/api/events/${id}/tasks/order`, { taskIds: [one] });
    expect(res.json.code).toBe("order_mismatch");
  });
});

describe("participants and assignments (QR021)", () => {
  it("assigns team members and guests to tasks in roll-call order", async () => {
    const chi = await joinTeam("Chi", "chi@example.com", "member");
    const id = await createEvent();
    const member = (await ada.post(`/api/events/${id}/participants`, { userId: chi.userId })).json.participantId;
    const guest = (await ada.post(`/api/events/${id}/participants`, { guestName: "Dr. Funmi Ade", guestEmail: "Funmi@Example.com" })).json.participantId;

    const detail = (await ada.post(`/api/events/${id}/tasks`, { title: "Keynote", durationMinutes: 30, assigneeIds: [guest, member] })).json;
    expect(detail.tasks[0].assigneeIds).toEqual([guest, member]);
    expect(detail.participants).toEqual([
      expect.objectContaining({ id: member, kind: "member", name: "Chi Test", email: "chi@example.com", response: "acknowledged" }),
      expect.objectContaining({ id: guest, kind: "guest", name: "Dr. Funmi Ade", email: "funmi@example.com" }),
    ]);
  });

  it("only assigns people who are in the event", async () => {
    const id = await createEvent();
    const res = await ada.post(`/api/events/${id}/tasks`, { title: "X", durationMinutes: 5, assigneeIds: ["nobody"] });
    expect(res.json.fields.assigneeIds).toBe("Only people added to this event can be assigned.");
  });

  it("only adds people who are on the team", async () => {
    const outsider = await person("Eve", "eve@example.com");
    const userId = (await outsider.get("/api/auth/me")).json.user.id;
    const id = await createEvent();
    expect((await ada.post(`/api/events/${id}/participants`, { userId })).status).toBe(400);
  });

  it("asks for team members to be added as members, not guests", async () => {
    await joinTeam("Chi", "chi@example.com", "member");
    const id = await createEvent();
    const res = await ada.post(`/api/events/${id}/participants`, { guestName: "Chi", guestEmail: "chi@example.com" });
    expect(res.status).toBe(409);
  });

  it("won't add the same person twice", async () => {
    const id = await createEvent();
    await ada.post(`/api/events/${id}/participants`, { guestName: "Funmi", guestEmail: "funmi@example.com" });
    expect((await ada.post(`/api/events/${id}/participants`, { guestName: "Funmi A", guestEmail: "funmi@example.com" })).status).toBe(409);
  });

  it("removing someone takes them off their tasks", async () => {
    const id = await createEvent();
    const guest = (await ada.post(`/api/events/${id}/participants`, { guestName: "Funmi", guestEmail: "funmi@example.com" })).json.participantId;
    await ada.post(`/api/events/${id}/tasks`, { title: "Keynote", durationMinutes: 30, assigneeIds: [guest] });
    const detail = (await ada.request("DELETE", `/api/events/${id}/participants/${guest}`)).json;
    expect(detail.participants).toEqual([]);
    expect(detail.tasks[0].assigneeIds).toEqual([]);
  });

  it("replaces a task's assignees when edited", async () => {
    const id = await createEvent();
    const g1 = (await ada.post(`/api/events/${id}/participants`, { guestName: "A", guestEmail: "a@example.com" })).json.participantId;
    const g2 = (await ada.post(`/api/events/${id}/participants`, { guestName: "B", guestEmail: "b@example.com" })).json.participantId;
    const task = (await ada.post(`/api/events/${id}/tasks`, { title: "Panel", durationMinutes: 30, assigneeIds: [g1] })).json.taskId;
    const detail = (await ada.request("PATCH", `/api/events/${id}/tasks/${task}`, { assigneeIds: [g2, g1] })).json;
    expect(detail.tasks[0].assigneeIds).toEqual([g2, g1]);
  });
});

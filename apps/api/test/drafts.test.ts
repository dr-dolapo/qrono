import { beforeEach, describe, expect, it } from "vitest";
import { editorsOf, parseEditing } from "../src/live/presence";
import { Browser, createTestEnv, tokenFromEmail } from "./helpers/client";

let t: ReturnType<typeof createTestEnv>;
let ada: Browser; // Admin
let tunde: Browser; // Planner
let adaId: string;
let eventId: string;

async function person(first: string, email: string): Promise<Browser> {
  const b = new Browser(t.env);
  await b.post("/api/auth/signup", { firstName: first, lastName: "Test", email, password: "correct horse battery" });
  await b.post("/api/auth/verify-email", { token: tokenFromEmail(t.emails.at(-1)) });
  return b;
}

beforeEach(async () => {
  t = createTestEnv();
  ada = await person("Ada", "ada@example.com");
  adaId = (await ada.get("/api/auth/me")).json.user.id;
  const teamId = (await ada.post("/api/teams", { name: "Events Team" })).json.team.id;
  await ada.post(`/api/teams/${teamId}/invites`, { email: "tunde@example.com", role: "admin" });
  const invite = t.emails.at(-1)!.text.match(/\/invite\/([A-Za-z0-9_-]+)/)![1];
  tunde = await person("Tunde", "tunde@example.com");
  await tunde.post(`/api/invites/${invite}/accept`);
  eventId = (
    await ada.post(`/api/teams/${teamId}/events`, {
      name: "Sunday Service",
      startAt: "2030-06-02T08:00:00.000Z",
      endAt: "2030-06-02T09:00:00.000Z",
      timezone: "Africa/Lagos",
    })
  ).json.event.id;
});

const live = () => t.env.LIVE_EVENT as unknown as { draftEdits: { eventId: string; by: { name: string | null } }[] };

describe("drafts: just the what, then the when and who", () => {
  it("the team's drafts are on every Admin's and Planner's events list, so they can build it together", async () => {
    for (const who of [ada, tunde]) {
      const { events } = (await who.get("/api/me/events")).json;
      expect(events.map((e: { id: string; status: string }) => [e.id, e.status])).toEqual([[eventId, "draft"]]);
    }
  });

  it("an item can be just a title; it takes no time until it has a length", async () => {
    let detail = (await ada.post(`/api/events/${eventId}/tasks`, { title: "Opening prayer", durationMinutes: 5, who: [{ userId: adaId }] })).json;
    detail = (await ada.post(`/api/events/${eventId}/tasks`, { title: "Announcements" })).json;
    detail = (await ada.post(`/api/events/${eventId}/tasks`, { title: "Sermon", durationMinutes: 30 })).json;
    expect(detail.tasks.map((x: { durationMinutes: number | null }) => x.durationMinutes)).toEqual([5, null, 30]);
    // Announcements has no length, so the sermon starts straight after the opening prayer.
    expect(detail.tasks[2].startAt).toBe("2030-06-02T08:05:00.000Z");

    // A length can be set, and cleared again, while it's a draft.
    const announcements = detail.tasks[1].id;
    detail = (await ada.request("PATCH", `/api/events/${eventId}/tasks/${announcements}`, { durationMinutes: 10 })).json;
    expect(detail.tasks[1].durationMinutes).toBe(10);
    expect(detail.tasks[2].startAt).toBe("2030-06-02T08:15:00.000Z");
    detail = (await ada.request("PATCH", `/api/events/${eventId}/tasks/${announcements}`, { durationMinutes: null })).json;
    expect(detail.tasks[1].durationMinutes).toBeNull();
  });

  it("nothing goes out until every item has a length and someone to run it", async () => {
    await ada.post(`/api/events/${eventId}/tasks`, { title: "Opening prayer", durationMinutes: 5, who: [{ userId: adaId }] });
    const sermon = (await ada.post(`/api/events/${eventId}/tasks`, { title: "Sermon" })).json.taskId;
    await ada.post(`/api/events/${eventId}/tasks`, { title: "Offering", durationMinutes: 5 });

    let res = await ada.post(`/api/events/${eventId}/submit`, { approverIds: [adaId] });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ code: "agenda_incomplete", error: "Every item needs a length and someone to run it. 2 items still don't." });

    await ada.request("PATCH", `/api/events/${eventId}/tasks/${sermon}`, { durationMinutes: 30, who: [{ userId: adaId }] });
    const detail = (await ada.get(`/api/events/${eventId}`)).json;
    await ada.request("PATCH", `/api/events/${eventId}/tasks/${detail.tasks[2].id}`, { who: [{ userId: adaId }] });
    res = await ada.post(`/api/events/${eventId}/submit`, { approverIds: [adaId] });
    expect(res.status).toBe(200);

    // Once it's published, a length can't be taken away.
    await ada.post(`/api/events/${eventId}/approve`);
    res = await ada.request("PATCH", `/api/events/${eventId}/tasks/${sermon}`, { durationMinutes: null });
    expect(res.status).toBe(400);
  });
});

describe("drafts: editing together", () => {
  it("every change to a draft refreshes the other editors' screens, saying who made it", async () => {
    await tunde.post(`/api/events/${eventId}/tasks`, { title: "Testimonies" });
    expect(live().draftEdits.at(-1)).toMatchObject({ eventId, by: { name: "Tunde Test" } });
    const before = live().draftEdits.length;
    await ada.request("PATCH", `/api/events/${eventId}`, { name: "Sunday Service (Combined)" });
    expect(live().draftEdits.length).toBe(before + 1);
  });

  it("shows each Admin or Planner once, with the item they have open", () => {
    const editors = editorsOf([
      { userId: "a", name: "Ada Obi", viewer: "manager", taskId: null },
      { userId: "a", name: "Ada Obi", viewer: "manager", taskId: "t2" }, // her laptop
      { userId: "t", name: "Tunde Bakare", viewer: "manager", taskId: null },
      { userId: "c", name: "Chi", viewer: "participant", taskId: null },
    ]);
    expect(editors).toEqual([
      { userId: "a", name: "Ada Obi", taskId: "t2" },
      { userId: "t", name: "Tunde Bakare", taskId: null },
    ]);
    expect(parseEditing('{"type":"editing","taskId":"t2"}')).toEqual({ taskId: "t2" });
    expect(parseEditing('{"type":"editing","taskId":null}')).toEqual({ taskId: null });
    expect(parseEditing("ping")).toBeNull();
  });
});

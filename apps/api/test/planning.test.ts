import { beforeEach, describe, expect, it } from "vitest";
import { Browser, createTestEnv, tokenFromEmail } from "./helpers/client";

let t: ReturnType<typeof createTestEnv>;
let ada: Browser; // Admin, creates the team
let adaId: string;
let teamId: string;

const when = { startAt: "2030-06-01T09:00:00.000Z", endAt: "2030-06-01T12:00:00.000Z", timezone: "Africa/Lagos" };
const settle = () => new Promise((r) => setTimeout(r, 30));

async function person(first: string, email: string): Promise<Browser> {
  const b = new Browser(t.env);
  await b.post("/api/auth/signup", { firstName: first, lastName: "Test", email, password: "correct horse battery" });
  await b.post("/api/auth/verify-email", { token: tokenFromEmail(t.emails.at(-1)) });
  return b;
}

async function joinTeam(browser: Browser, email: string, team = teamId, by = ada) {
  await by.post(`/api/teams/${team}/invites`, { email, role: "member" });
  const token = t.emails.at(-1)!.text.match(/\/invite\/([A-Za-z0-9_-]+)/)![1];
  await browser.post(`/api/invites/${token}/accept`);
  return (await browser.get("/api/auth/me")).json.user.id as string;
}

async function newEvent(name = "Monday Meeting", by = ada, team = teamId): Promise<string> {
  return (await by.post(`/api/teams/${team}/events`, { ...when, name })).json.event.id;
}

async function approve(eventId: string) {
  const submit = await ada.post(`/api/events/${eventId}/submit`, { approverIds: [adaId] });
  if (submit.status !== 200) return submit;
  return ada.post(`/api/events/${eventId}/approve`);
}

async function addContact(name: string, email?: string) {
  return (await ada.post(`/api/teams/${teamId}/people`, email ? { name, email } : { name })).json.person;
}

beforeEach(async () => {
  t = createTestEnv();
  ada = await person("Ada", "ada@example.com");
  adaId = (await ada.get("/api/auth/me")).json.user.id;
  teamId = (await ada.post("/api/teams", { name: "Events Team" })).json.team.id;
});

describe("the team's people list", () => {
  it("lists members as joined and new people as not invited yet", async () => {
    const bola = await person("Bola", "bola@example.com");
    await joinTeam(bola, "bola@example.com");
    const jack = await addContact("Jack Sparrow");
    expect(jack).toMatchObject({ kind: "contact", name: "Jack Sparrow", email: null });

    const { people } = (await ada.get(`/api/teams/${teamId}/people`)).json;
    expect(people.map((p: { name: string; status: string }) => `${p.name}:${p.status}`)).toEqual([
      "Ada Test:member",
      "Bola Test:member",
      "Jack Sparrow:not_invited",
    ]);
  });

  it("returns the member when a new person's email is already on the team", async () => {
    const bola = await person("Bola", "bola@example.com");
    const bolaId = await joinTeam(bola, "bola@example.com");
    expect(await addContact("B. Test", "BOLA@example.com")).toMatchObject({ kind: "member", userId: bolaId });
  });

  it("is only for Admins and Planners, and only for your own team", async () => {
    const bola = await person("Bola", "bola@example.com");
    await joinTeam(bola, "bola@example.com");
    expect((await bola.get(`/api/teams/${teamId}/people`)).status).toBe(403);

    const eve = await person("Eve", "eve@example.com");
    await eve.post("/api/teams", { name: "Other Org" });
    expect((await eve.get(`/api/teams/${teamId}/people`)).status).toBe(404);
  });
});

describe("Who on an agenda item", () => {
  it("adds team members and new people to the event as they're chosen", async () => {
    const bola = await person("Bola", "bola@example.com");
    const bolaId = await joinTeam(bola, "bola@example.com");
    const jack = await addContact("Jack Sparrow");
    const id = await newEvent();

    const res = await ada.post(`/api/events/${id}/tasks`, {
      title: "Opening prayer",
      durationMinutes: 15,
      who: [{ contactId: jack.contactId }, { userId: bolaId }],
    });
    expect(res.status).toBe(201);
    const detail = res.json;
    const names = detail.tasks[0].assigneeIds.map((pid: string) => detail.participants.find((p: { id: string }) => p.id === pid).name);
    expect(names).toEqual(["Jack Sparrow", "Bola Test"]);
    expect(detail.participants.find((p: { name: string }) => p.name === "Jack Sparrow")).toMatchObject({ kind: "guest", email: null, contactId: jack.contactId });

    // Choosing the same people again reuses their places on the event.
    await ada.post(`/api/events/${id}/tasks`, { title: "Closing", durationMinutes: 5, who: [{ userId: bolaId }] });
    expect((await ada.get(`/api/events/${id}`)).json.participants).toHaveLength(2);
  });

  it("needs at least one person, and only people from this team", async () => {
    const id = await newEvent();
    expect((await ada.post(`/api/events/${id}/tasks`, { title: "Nobody", durationMinutes: 5, who: [] })).json.fields.who).toBe("Choose who runs this.");

    const eve = await person("Eve", "eve@example.com");
    const otherTeam = (await eve.post("/api/teams", { name: "Other Org" })).json.team.id;
    const eveContact = (await eve.post(`/api/teams/${otherTeam}/people`, { name: "Their Guest" })).json.person;
    const eveId = (await eve.get("/api/auth/me")).json.user.id;
    for (const who of [[{ contactId: eveContact.contactId }], [{ userId: eveId }]]) {
      const res = await ada.post(`/api/events/${id}/tasks`, { title: "Sneaky", durationMinutes: 5, who });
      expect(res.status).toBe(400);
    }
  });

  it("asks for emails before review, then invites new people when the program is approved", async () => {
    const jack = await addContact("Jack Sparrow");
    const id = await newEvent();
    await ada.post(`/api/events/${id}/tasks`, { title: "Opening prayer", durationMinutes: 15, who: [{ contactId: jack.contactId }] });

    const blocked = await ada.post(`/api/events/${id}/submit`, { approverIds: [adaId] });
    expect(blocked.status).toBe(409);
    expect(blocked.json).toMatchObject({ code: "missing_emails", error: expect.stringContaining("Jack Sparrow") });

    const listed = (await ada.get(`/api/teams/${teamId}/events`)).json.events[0];
    expect(listed).toMatchObject({ missingEmailCount: 1, awaitingMyApproval: false });

    await ada.request("PATCH", `/api/teams/${teamId}/people/${jack.contactId}`, { email: "jack@example.com" });
    expect((await ada.get(`/api/events/${id}`)).json.participants[0].email).toBe("jack@example.com");

    // Sent to Ada for review: the events list flags it as waiting for her.
    await ada.post(`/api/events/${id}/submit`, { approverIds: [adaId] });
    expect((await ada.get(`/api/teams/${teamId}/events`)).json.events[0]).toMatchObject({ missingEmailCount: 0, awaitingMyApproval: true });
    await ada.post(`/api/events/${id}/withdraw`);

    t.emails.length = 0;
    expect((await approve(id)).status).toBe(200);
    await settle();
    const toJack = t.emails.filter((e) => e.to === "jack@example.com");
    expect(toJack.map((e) => e.subject).join(" | ")).toMatch(/invited you to Events Team/);
    expect(toJack.some((e) => /\/g\//.test(e.text))).toBe(true); // their personal link for the event
    const { people } = (await ada.get(`/api/teams/${teamId}/people`)).json;
    expect(people.find((p: { name: string }) => p.name === "Jack Sparrow").status).toBe("invited");

    // Once Jack joins, his place on the program is his as a member, and he shows as joined.
    const jackBrowser = await person("Jack", "jack@example.com");
    const invite = toJack.find((e) => /\/invite\//.test(e.text))!;
    const token = invite.text.match(/\/invite\/([A-Za-z0-9_-]+)/)![1];
    expect((await jackBrowser.post(`/api/invites/${token}/accept`)).status).toBe(200);
    const jackId = (await jackBrowser.get("/api/auth/me")).json.user.id;
    const after = (await ada.get(`/api/events/${id}`)).json;
    expect(after.participants[0]).toMatchObject({ kind: "member", userId: jackId });
    expect((await jackBrowser.get("/api/me/events")).json.events.map((e: { id: string }) => e.id)).toEqual([id]);
    const list = (await ada.get(`/api/teams/${teamId}/people`)).json.people;
    expect(list.filter((p: { email: string }) => p.email === "jack@example.com")).toEqual([expect.objectContaining({ status: "member" })]);
  });

  it("needs a new person's email before adding them to an approved program", async () => {
    const bola = await person("Bola", "bola@example.com");
    const bolaId = await joinTeam(bola, "bola@example.com");
    const id = await newEvent();
    await ada.post(`/api/events/${id}/tasks`, { title: "Welcome", durationMinutes: 5, who: [{ userId: bolaId }] });
    await approve(id);
    const jack = await addContact("Jack Sparrow");
    const res = await ada.post(`/api/events/${id}/tasks`, { title: "Prayer", durationMinutes: 5, who: [{ contactId: jack.contactId }] });
    expect(res.status).toBe(400);
    expect(res.json.fields.who).toMatch(/Add an email for Jack Sparrow first/);
  });

  it("merges a new person into the member with that email", async () => {
    const bola = await person("Bola", "bola@example.com");
    const bolaId = await joinTeam(bola, "bola@example.com");
    const b = await addContact("B");
    const id = await newEvent();
    await ada.post(`/api/events/${id}/tasks`, { title: "Welcome", durationMinutes: 5, who: [{ contactId: b.contactId }] });
    expect((await ada.request("PATCH", `/api/teams/${teamId}/people/${b.contactId}`, { email: "bola@example.com" })).json).toEqual({ merged: true });
    expect((await ada.get(`/api/events/${id}`)).json.participants).toEqual([expect.objectContaining({ kind: "member", userId: bolaId })]);
    expect((await ada.get(`/api/teams/${teamId}/people`)).json.people.map((p: { name: string }) => p.name)).toEqual(["Ada Test", "Bola Test"]);
  });
});

describe("suggestions for What", () => {
  async function approvedProgram(titles: string[], by = ada, team = teamId, byId = adaId) {
    const id = await newEvent("Past", by, team);
    for (const title of titles) await by.post(`/api/events/${id}/tasks`, { title, durationMinutes: 5, who: [{ userId: byId }] });
    await by.post(`/api/events/${id}/submit`, { approverIds: [byId] });
    await by.post(`/api/events/${id}/approve`);
  }

  it("only uses this team's approved agendas, matches first, most used next", async () => {
    await approvedProgram(["Opening prayer", "Welcome", "Closing prayer"]);
    await approvedProgram(["Opening prayer", "Opening remarks"]);
    // A draft's items aren't approved yet.
    const draft = await newEvent("Draft");
    await ada.post(`/api/events/${draft}/tasks`, { title: "Open mic", durationMinutes: 5 });
    // Another organisation's items are never suggested.
    const eve = await person("Eve", "eve@example.com");
    const eveId = (await eve.get("/api/auth/me")).json.user.id;
    const otherTeam = (await eve.post("/api/teams", { name: "Other Org" })).json.team.id;
    await approvedProgram(["Opening ceremony"], eve, otherTeam, eveId);

    const get = async (q: string) => (await ada.get(`/api/teams/${teamId}/agenda-suggestions?q=${encodeURIComponent(q)}`)).json.suggestions;
    expect(await get("open")).toEqual(["Opening prayer", "Opening remarks"]);
    expect(await get("prayer")).toEqual(["Opening prayer", "Closing prayer"]);
    expect(await get("%")).toEqual([]);
    expect(await get("")).toEqual([]);
    expect((await eve.get(`/api/teams/${teamId}/agenda-suggestions?q=open`)).status).toBe(404);
  });
});

describe("starting from a template", () => {
  it("lists the team's previous programs and copies What and Duration only", async () => {
    const bola = await person("Bola", "bola@example.com");
    const bolaId = await joinTeam(bola, "bola@example.com");
    const past = await newEvent("Last Monday");
    await ada.post(`/api/events/${past}/tasks`, { title: "Opening prayer", durationMinutes: 15, who: [{ userId: bolaId }] });
    await ada.post(`/api/events/${past}/tasks`, { title: "Updates", durationMinutes: 30, who: [{ userId: bolaId }] });
    await approve(past);
    await newEvent("Unapproved draft"); // not offered: not approved

    const target = await newEvent("This Monday");
    const { templates } = (await ada.get(`/api/teams/${teamId}/templates?exclude=${target}`)).json;
    expect(templates).toEqual([expect.objectContaining({ eventId: past, name: "Last Monday", items: 2, minutes: 45 })]);

    const res = await ada.post(`/api/events/${target}/copy-from`, { sourceEventId: past });
    expect(res.status).toBe(201);
    expect(res.json.tasks.map((t: { title: string; durationMinutes: number; assigneeIds: string[] }) => [t.title, t.durationMinutes, t.assigneeIds.length])).toEqual([
      ["Opening prayer", 15, 0],
      ["Updates", 30, 0],
    ]);
    expect(res.json.participants).toEqual([]);

    // Only onto an empty agenda.
    expect((await ada.post(`/api/events/${target}/copy-from`, { sourceEventId: past })).json.code).toBe("agenda_not_empty");
  });

  it("never copies from another organisation", async () => {
    const eve = await person("Eve", "eve@example.com");
    const eveId = (await eve.get("/api/auth/me")).json.user.id;
    const otherTeam = (await eve.post("/api/teams", { name: "Other Org" })).json.team.id;
    const theirs = await newEvent("Theirs", eve, otherTeam);
    await eve.post(`/api/events/${theirs}/tasks`, { title: "Secret", durationMinutes: 5 });
    await eve.post(`/api/events/${theirs}/submit`, { approverIds: [eveId] });
    await eve.post(`/api/events/${theirs}/approve`);

    const mine = await newEvent();
    expect((await ada.post(`/api/events/${mine}/copy-from`, { sourceEventId: theirs })).status).toBe(404);
    expect((await ada.get(`/api/teams/${teamId}/templates`)).json.templates).toEqual([]);
  });
});

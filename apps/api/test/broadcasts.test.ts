import { beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "../src/live/commands";
import { Browser, createTestEnv, tokenFromEmail } from "./helpers/client";

let t: ReturnType<typeof createTestEnv>;
let ada: Browser; // Admin running the event
let chi: { browser: Browser; userId: string; participant: string }; // Member
let dayo: { browser: Browser; userId: string; participant: string }; // Member
let guest: string;
let eventId: string;

async function person(first: string, email: string): Promise<Browser> {
  const b = new Browser(t.env);
  await b.post("/api/auth/signup", { firstName: first, lastName: "Test", email, password: "correct horse battery" });
  await b.post("/api/auth/verify-email", { token: tokenFromEmail(t.emails.at(-1)) });
  return b;
}

const live = () => t.env.LIVE_EVENT as unknown as { alarms: Map<string, number | null>; deliveries: { userId: string; message: { broadcast: { body: string; realert: boolean } } }[] };

beforeEach(async () => {
  t = createTestEnv();
  ada = await person("Ada", "ada@example.com");
  const adaId = (await ada.get("/api/auth/me")).json.user.id;
  const teamId = (await ada.post("/api/teams", { name: "Events Team" })).json.team.id;
  eventId = (
    await ada.post(`/api/teams/${teamId}/events`, {
      name: "AGM",
      startAt: "2030-06-01T09:00:00.000Z",
      endAt: "2030-06-01T11:00:00.000Z",
      timezone: "Africa/Lagos",
    })
  ).json.event.id;

  async function member(first: string, email: string) {
    await ada.post(`/api/teams/${teamId}/invites`, { email, role: "member" });
    const invite = t.emails.at(-1)!.text.match(/\/invite\/([A-Za-z0-9_-]+)/)![1];
    const browser = await person(first, email);
    await browser.post(`/api/invites/${invite}/accept`);
    const userId = (await browser.get("/api/auth/me")).json.user.id as string;
    const participant = (await ada.post(`/api/events/${eventId}/participants`, { userId })).json.participantId as string;
    return { browser, userId, participant };
  }
  chi = await member("Chi", "chi@example.com");
  dayo = await member("Dayo", "dayo@example.com");
  guest = (await ada.post(`/api/events/${eventId}/participants`, { guestName: "Funmi", guestEmail: "funmi@example.com" })).json.participantId;
  await ada.post(`/api/events/${eventId}/tasks`, { title: "Opening", durationMinutes: 10, who: [{ userId: adaId }] });
  await ada.post(`/api/events/${eventId}/submit`, { approverIds: [adaId] });
  await ada.post(`/api/events/${eventId}/approve`);
});

const goLive = () => ada.post(`/api/events/${eventId}/live/start`);
const send = (body: object) => ada.post(`/api/events/${eventId}/broadcasts`, body);

describe("sending broadcasts (QR038, QR039)", () => {
  it("only while the event is live", async () => {
    const res = await send({ body: "Doors open", audience: "everyone" });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("event_not_live");
  });

  it("only by Admins and Planners", async () => {
    await goLive();
    expect((await chi.browser.post(`/api/events/${eventId}/broadcasts`, { body: "Hi", audience: "everyone" })).status).toBe(403);
  });

  it("to everyone: every registered participant, not guests, delivered to their screens", async () => {
    await goLive();
    const res = await send({ body: "Speaker on in 5 minutes", audience: "everyone" });
    expect(res.status).toBe(201);
    expect(res.json.broadcast.recipients).toBe(2);
    expect(live().deliveries.map((d) => d.userId).sort()).toEqual([chi.userId, dayo.userId].sort());
    expect(live().deliveries[0]!.message.broadcast).toMatchObject({ body: "Speaker on in 5 minutes", realert: false });
  });

  it("to selected participants only", async () => {
    await goLive();
    const res = await send({ body: "Chi, please come backstage", audience: "participants", participantIds: [chi.participant] });
    expect(res.json.broadcast.recipients).toBe(1);
    expect(live().deliveries.map((d) => d.userId)).toEqual([chi.userId]);
    const theirs = await dayo.browser.get(`/api/events/${eventId}/broadcasts`);
    expect(theirs.json.broadcasts).toEqual([]);
  });

  it("won't target guests or people outside the event", async () => {
    await goLive();
    expect((await send({ body: "Hi", audience: "participants", participantIds: [guest] })).json.fields.participantIds).toBe("Guests don't receive broadcasts.");
    expect((await send({ body: "Hi", audience: "participants", participantIds: ["nobody"] })).json.fields.participantIds).toBe("Choose people from this event.");
  });

  it("keeps messages short", async () => {
    await goLive();
    expect((await send({ body: "x".repeat(281), audience: "everyone" })).json.fields.body).toBe("Keep it to 280 characters.");
  });
});

describe("replies (QR041, QR042)", () => {
  let broadcastId: string;
  beforeEach(async () => {
    await goLive();
    broadcastId = (await send({ body: "Speaker on in 5 minutes", audience: "everyone" })).json.broadcast.id;
  });
  const reply = (who: Browser, response: string) => who.post(`/api/events/${eventId}/broadcasts/${broadcastId}/respond`, { response });

  it("recipients see their broadcasts and reply", async () => {
    const mine = await chi.browser.get(`/api/events/${eventId}/broadcasts`);
    expect(mine.json.broadcasts).toEqual([expect.objectContaining({ body: "Speaker on in 5 minutes", sentBy: "Ada Test", response: "none" })]);
    expect((await reply(chi.browser, "acknowledged")).status).toBe(200);
    expect((await reply(dayo.browser, "done")).status).toBe(200);

    const admin = await ada.get(`/api/events/${eventId}/broadcasts`);
    expect(admin.json.canSend).toBe(true);
    const replies = Object.fromEntries(admin.json.broadcasts[0].receipts.map((r: { name: string; response: string }) => [r.name, r.response]));
    expect(replies).toEqual({ "Chi Test": "acknowledged", "Dayo Test": "done" });
  });

  it("people who didn't receive it can't reply", async () => {
    expect((await reply(ada, "acknowledged")).status).toBe(404);
  });

  it("snooze comes back after 3 minutes", async () => {
    const before = Date.now();
    const res = await reply(chi.browser, "snoozed");
    const until = Date.parse(res.json.snoozeUntil);
    expect(until - before).toBeGreaterThanOrEqual(3 * 60_000 - 1000);
    expect(until - before).toBeLessThanOrEqual(3 * 60_000 + 1000);
    // The room will wake up for it.
    expect(live().alarms.get(eventId)).toBe(until);

    // 3 minutes later the room wakes, re-alerts Chi, and the reply resets.
    await runCommand(t.env.DB, eventId, { action: "tick", by: null }, until + 1);
    const row = t.sqlite.prepare("SELECT response, snooze_until, snooze_count FROM broadcast_receipts WHERE user_id = ?").get(chi.userId);
    expect(row).toEqual({ response: "none", snooze_until: null, snooze_count: 1 });
  });

  it("re-alerts carry the original message", async () => {
    await reply(chi.browser, "snoozed");
    const until = Date.parse(t.sqlite.prepare("SELECT snooze_until FROM broadcast_receipts WHERE user_id = ?").get(chi.userId)!.snooze_until as string);
    const result = await runCommand(t.env.DB, eventId, { action: "tick", by: null }, until + 1);
    expect(result.deliveries).toEqual([{ userId: chi.userId, message: expect.objectContaining({ broadcast: expect.objectContaining({ body: "Speaker on in 5 minutes", realert: true }) }) }]);
    expect(result.broadcastsChanged).toBe(true);
  });

  it("replies close when the event ends", async () => {
    await ada.post(`/api/events/${eventId}/live/end`);
    expect((await reply(chi.browser, "acknowledged")).status).toBe(409);
  });
});

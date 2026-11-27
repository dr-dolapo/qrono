import { beforeEach, describe, expect, it, vi } from "vitest";
import { apnsJwt } from "../src/apns";
import { syncLiveCards } from "../src/live/cards";
import { Browser, createTestEnv, tokenFromEmail } from "./helpers/client";

let t: ReturnType<typeof createTestEnv>;
let ada: Browser; // Admin running the event
let chi: { browser: Browser; userId: string }; // on the second item
let dayo: { browser: Browser; userId: string }; // on the program, no item
let eventId: string;

async function person(first: string, email: string): Promise<Browser> {
  const b = new Browser(t.env);
  await b.post("/api/auth/signup", { firstName: first, lastName: "Test", email, password: "correct horse battery" });
  await b.post("/api/auth/verify-email", { token: tokenFromEmail(t.emails.at(-1)) });
  return b;
}

/** A real P-256 key as Apple would issue it (.p8 = PKCS#8 PEM). */
async function testKey(): Promise<string> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
}

type Call = { url: string; headers: Record<string, string>; body: { aps?: Record<string, unknown> } | { to: string; data: Record<string, string> }[] };
function recorder() {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    return url.includes("exp.host") ? Response.json({ data: (JSON.parse(init.body as string) as unknown[]).map(() => ({ status: "ok" })) }) : new Response(null, { status: 200 });
  });
  return { calls, fetcher: fetcher as unknown as typeof fetch, apple: () => calls.filter((c) => c.url.includes("apple.com")), expo: () => calls.filter((c) => c.url.includes("exp.host")) };
}

const sync = (fetcher: typeof fetch) => syncLiveCards(t.env, eventId, Date.now(), fetcher);
const iosToken = (n: number) => n.toString(16).padStart(64, "a");
const contentProps = (c: Call) => JSON.parse(((c.body as { aps: { "content-state": { props: string } } }).aps["content-state"]).props);

beforeEach(async () => {
  t = createTestEnv();
  Object.assign(t.env, { APNS_KEY: await testKey(), APNS_KEY_ID: "KEY123", APNS_TEAM_ID: "TEAM123" });
  ada = await person("Ada", "ada@example.com");
  const adaId = (await ada.get("/api/auth/me")).json.user.id;
  const teamId = (await ada.post("/api/teams", { name: "Events Team" })).json.team.id;
  eventId = (await ada.post(`/api/teams/${teamId}/events`, { name: "AGM", startAt: "2030-06-01T09:00:00.000Z", endAt: "2030-06-01T11:00:00.000Z", timezone: "Africa/Lagos" })).json.event.id;

  async function member(first: string, email: string) {
    await ada.post(`/api/teams/${teamId}/invites`, { email, role: "member" });
    const invite = t.emails.at(-1)!.text.match(/\/invite\/([A-Za-z0-9_-]+)/)![1];
    const browser = await person(first, email);
    await browser.post(`/api/invites/${invite}/accept`);
    return { browser, userId: (await browser.get("/api/auth/me")).json.user.id as string };
  }
  chi = await member("Chi", "chi@example.com");
  dayo = await member("Dayo", "dayo@example.com");
  await ada.post(`/api/events/${eventId}/participants`, { userId: dayo.userId });
  await ada.post(`/api/events/${eventId}/tasks`, { title: "Opening", durationMinutes: 10, who: [{ userId: adaId }] });
  await ada.post(`/api/events/${eventId}/tasks`, { title: "Treasurer's report", durationMinutes: 10, who: [{ userId: chi.userId }] });
  await ada.post(`/api/events/${eventId}/submit`, { approverIds: [adaId] });
  await ada.post(`/api/events/${eventId}/approve`);

  // Chi's iPhone can be started by push; Dayo's Android phone takes data messages.
  expect((await chi.browser.post("/api/me/live-activity-tokens", { token: iosToken(1), kind: "start" })).status).toBe(200);
  await dayo.browser.post("/api/me/devices", { token: "ExponentPushToken[dayo-android-1]", platform: "android" });
});

describe("lock-screen cards during a live event", () => {
  it("open when it goes live, change around your part and broadcasts, and close when it ends", async () => {
    let r = recorder();
    expect(await sync(r.fetcher)).toMatchObject({ ios: 0, android: 0 }); // not live yet

    await ada.post(`/api/events/${eventId}/live/start`);
    r = recorder();
    // It also says when a card next changes colour on its own, so the room can wake then.
    expect((await sync(r.fetcher)).changesAt).toEqual(expect.any(Number));
    // Chi's iPhone gets a push-to-start, signed for Apple's Live Activity topic.
    const [start] = r.apple();
    expect(start!.url).toBe(`https://api.push.apple.com/3/device/${iosToken(1)}`);
    expect(start!.headers).toMatchObject({ "apns-push-type": "liveactivity", "apns-topic": "uk.co.qrono.app.push-type.liveactivity", "apns-priority": "10" });
    expect(start!.headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    const aps = (start!.body as { aps: Record<string, unknown> }).aps;
    expect(aps).toMatchObject({ event: "start", "attributes-type": "LiveActivityAttributes", "input-push-token": 1 });
    expect(contentProps(start!)).toMatchObject({ eventName: "AGM", headline: "You're up next", detail: "Treasurer's report", urgent: true });
    // The pushdown, as on the event screen: Chi's countdown to her part, purple until the warning window.
    expect(contentProps(start!)).toMatchObject({ caption: "Your part · Treasurer's report", over: false, text: null });
    expect(["purple", "amber"]).toContain(contentProps(start!).tone);
    expect(typeof contentProps(start!).target).toBe("number");
    // Dayo's Android phone gets a silent data message to draw the card.
    const [batch] = r.expo();
    const msg = (batch!.body as { to: string; data: Record<string, string> }[])[0]!;
    expect(msg).toMatchObject({ to: "ExponentPushToken[dayo-android-1]", data: { type: "live", eventId } });
    expect(msg).not.toHaveProperty("title");
    expect(JSON.parse(msg.data.card!)).toMatchObject({ headline: "Live now", urgent: false });
    // Dayo has no part: his card follows the item on now.
    expect(JSON.parse(msg.data.card!).caption).toMatch(/^On now · /);

    // Nothing changed: nothing is sent.
    r = recorder();
    await sync(r.fetcher);
    expect(r.calls).toEqual([]);

    // The started card hands back its own token (iOS 18): later changes go to it.
    // (The app doesn't know which event a pushed card is for; the server does.)
    expect((await chi.browser.post("/api/me/live-activity-tokens", { token: iosToken(2), kind: "activity" })).json.eventId).toBe(eventId);

    // A broadcast reaches both cards.
    await ada.post(`/api/events/${eventId}/broadcasts`, { body: "Please take your seats", audience: "everyone" });
    r = recorder();
    await sync(r.fetcher);
    const [update] = r.apple();
    expect(update!.url).toContain(iosToken(2));
    expect((update!.body as { aps: Record<string, unknown> }).aps).toMatchObject({ event: "update", alert: { title: "AGM", body: "Ada Test: Please take your seats" } });
    expect(contentProps(update!).broadcast).toBe("Ada Test: Please take your seats");
    expect(r.expo()).toHaveLength(1);

    // Chi's item starts: "You're on now", and her card turns green. Dayo's follows the new item.
    await ada.post(`/api/events/${eventId}/live/next`);
    r = recorder();
    await sync(r.fetcher);
    expect(r.apple().map(contentProps)).toEqual([
      expect.objectContaining({ headline: "You're on now", detail: "Treasurer's report", tone: "green", caption: "You're on now · Treasurer's report" }),
    ]);
    // A colour change goes out straight away, not when iOS finds it convenient.
    expect(r.apple()[0]!.headers["apns-priority"]).toBe("10");
    expect(JSON.parse((r.expo()[0]!.body as { data: Record<string, string> }[])[0]!.data.card!).caption).toBe("On now · Treasurer's report");

    // The event ends: every card closes, and the per-event tokens are forgotten.
    await ada.post(`/api/events/${eventId}/live/end`);
    r = recorder();
    await sync(r.fetcher);
    const endAps = (r.apple()[0]!.body as { aps: Record<string, number> }).aps;
    expect(endAps).toMatchObject({ event: "end" });
    // Off the Lock Screen at once, not left showing "Ended".
    expect(endAps["dismissal-date"]).toBe(endAps.timestamp);
    expect(r.apple()[0]!.headers["apns-priority"]).toBe("10");
    expect(contentProps(r.apple()[0]!).headline).toBe("Ended");
    expect((r.expo()[0]!.body as { data: Record<string, string> }[])[0]!.data).toEqual({ type: "live-end", eventId });
    r = recorder();
    await sync(r.fetcher);
    expect(r.calls).toEqual([]);
  });

  it("lets the app fetch its open cards, for phones that can't be started by push", async () => {
    expect((await dayo.browser.get("/api/me/live-cards")).json.cards).toEqual([]);
    await ada.post(`/api/events/${eventId}/live/start`);
    const { cards } = (await chi.browser.get("/api/me/live-cards")).json;
    expect(cards).toEqual([expect.objectContaining({ eventId, headline: "You're up next", detail: "Treasurer's report" })]);
    // Only people on the event can register a card's token for it.
    const stranger = await person("Eko", "eko@example.com");
    expect((await stranger.post("/api/me/live-activity-tokens", { token: iosToken(9), kind: "activity", eventId })).status).toBe(404);
  });

  it("forgets tokens Apple says are gone, and sends nothing to Apple without a key", async () => {
    await ada.post(`/api/events/${eventId}/live/start`);
    const gone = vi.fn(async () => Response.json({ reason: "Unregistered" }, { status: 410 }));
    await syncLiveCards(t.env, eventId, Date.now(), gone as unknown as typeof fetch);
    expect(await t.env.DB.prepare("SELECT COUNT(*) AS n FROM live_activity_tokens").first("n")).toBe(0);

    const r = recorder();
    Object.assign(t.env, { APNS_KEY: undefined });
    await chi.browser.post("/api/me/live-activity-tokens", { token: iosToken(3), kind: "activity", eventId });
    await ada.post(`/api/events/${eventId}/broadcasts`, { body: "Hello", audience: "everyone" });
    await syncLiveCards(t.env, eventId, Date.now(), r.fetcher);
    expect(r.apple()).toEqual([]);
  });

  it("signs a JWT Apple can verify", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
    const jwt = await apnsJwt({ APNS_KEY: btoa(String.fromCharCode(...der)), APNS_KEY_ID: "OTHERKEY", APNS_TEAM_ID: "TEAM9" });
    const [h, b, s] = jwt.split(".");
    const dec = (x: string) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
    expect(JSON.parse(new TextDecoder().decode(dec(h!)))).toEqual({ alg: "ES256", kid: "OTHERKEY" });
    expect(JSON.parse(new TextDecoder().decode(dec(b!)))).toMatchObject({ iss: "TEAM9" });
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, dec(s!), new TextEncoder().encode(`${h}.${b}`))).toBe(true);
  });
});

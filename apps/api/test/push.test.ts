import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app";
import { pushBroadcasts } from "../src/push";
import { Browser, createTestEnv, tokenFromEmail } from "./helpers/client";

let t: ReturnType<typeof createTestEnv>;

async function person(first: string, email: string): Promise<{ browser: Browser; id: string; token: string }> {
  const b = new Browser(t.env);
  await b.post("/api/auth/signup", { firstName: first, lastName: "Test", email, password: "correct horse battery" });
  await b.post("/api/auth/verify-email", { token: tokenFromEmail(t.emails.at(-1)) });
  const login = await app.request(
    "/api/auth/login",
    { method: "POST", headers: { "Content-Type": "application/json", "X-Qrono-Client": "mobile" }, body: JSON.stringify({ email, password: "correct horse battery" }) },
    t.env,
  );
  const json = (await login.json()) as { user: { id: string }; session: { token: string } };
  return { browser: b, id: json.user.id, token: json.session.token };
}

function phone(token: string, path: string, body: unknown) {
  return app.request(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Qrono-Client": "mobile", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    },
    t.env,
  );
}

const TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
const TOKEN_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]";
const tokens = () => t.sqlite.prepare("SELECT user_id, token, platform FROM device_tokens ORDER BY token").all();

beforeEach(() => {
  t = createTestEnv();
});

describe("registering phones for push (QR040)", () => {
  it("stores a phone's push token for the signed-in user", async () => {
    const ada = await person("Ada", "ada@example.com");
    expect((await phone(ada.token, "/api/me/devices", { token: TOKEN_A, platform: "ios" })).status).toBe(200);
    // Registering again (every app launch) doesn't duplicate it.
    await phone(ada.token, "/api/me/devices", { token: TOKEN_A, platform: "ios" });
    expect(tokens()).toEqual([{ user_id: ada.id, token: TOKEN_A, platform: "ios" }]);
  });

  it("moves a phone to whoever logs in on it", async () => {
    const ada = await person("Ada", "ada@example.com");
    const bola = await person("Bola", "bola@example.com");
    await phone(ada.token, "/api/me/devices", { token: TOKEN_A, platform: "android" });
    await phone(bola.token, "/api/me/devices", { token: TOKEN_A, platform: "android" });
    expect(tokens()).toEqual([{ user_id: bola.id, token: TOKEN_A, platform: "android" }]);
  });

  it("removes the phone on log out, but only for its owner", async () => {
    const ada = await person("Ada", "ada@example.com");
    const bola = await person("Bola", "bola@example.com");
    await phone(ada.token, "/api/me/devices", { token: TOKEN_A, platform: "ios" });
    await phone(bola.token, "/api/me/devices/unregister", { token: TOKEN_A });
    expect(tokens()).toHaveLength(1);
    await phone(ada.token, "/api/me/devices/unregister", { token: TOKEN_A });
    expect(tokens()).toHaveLength(0);
  });

  it("rejects anything that isn't an Expo push token", async () => {
    const ada = await person("Ada", "ada@example.com");
    const res = await phone(ada.token, "/api/me/devices", { token: "not-a-token", platform: "ios" });
    expect(res.status).toBe(400);
  });
});

describe("sending broadcasts as push notifications", () => {
  async function setup() {
    const ada = await person("Ada", "ada@example.com");
    const teamId = (await ada.browser.post("/api/teams", { name: "Events Team" })).json.team.id;
    const eventId = (
      await ada.browser.post(`/api/teams/${teamId}/events`, {
        name: "AGM",
        startAt: "2030-06-01T09:00:00.000Z",
        endAt: "2030-06-01T11:00:00.000Z",
        timezone: "Africa/Lagos",
      })
    ).json.event.id;
    return { ada, eventId };
  }

  const delivery = (userId: string, realert = false) => ({
    userId,
    message: { type: "broadcast" as const, broadcast: { id: "b1", body: "Mic check in 5", sentBy: "Ada Test", sentAt: "2030-06-01T09:30:00.000Z", realert } },
  });

  it("sends one notification per phone with the reply buttons, and drops dead tokens", async () => {
    const { ada, eventId } = await setup();
    t.sqlite.prepare("INSERT INTO device_tokens (id, user_id, platform, token) VALUES ('d1', ?, 'ios', ?), ('d2', ?, 'android', ?)").run(ada.id, TOKEN_A, ada.id, TOKEN_B);
    const fetcher = vi.fn(async () =>
      Response.json({ data: [{ status: "ok", id: "t1" }, { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }] }),
    );

    const sent = await pushBroadcasts(t.env, eventId, [delivery(ada.id)], fetcher as unknown as typeof fetch);
    expect(sent).toBe(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    const messages = JSON.parse(String(init.body));
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      to: TOKEN_A,
      title: "AGM",
      body: "Ada Test: Mic check in 5",
      data: { type: "broadcast", eventId, broadcastId: "b1" },
      categoryId: "broadcast",
      channelId: "broadcasts",
      priority: "high",
    });
    expect(tokens()).toEqual([{ user_id: ada.id, token: TOKEN_A, platform: "ios" }]);
  });

  it("marks snooze re-alerts as reminders", async () => {
    const { ada, eventId } = await setup();
    t.sqlite.prepare("INSERT INTO device_tokens (id, user_id, platform, token) VALUES ('d1', ?, 'ios', ?)").run(ada.id, TOKEN_A);
    const fetcher = vi.fn(async () => Response.json({ data: [{ status: "ok" }] }));
    await pushBroadcasts(t.env, eventId, [delivery(ada.id, true)], fetcher as unknown as typeof fetch);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))[0].title).toBe("Reminder: AGM");
  });

  it("does nothing when nobody has a phone registered, and survives Expo being down", async () => {
    const { ada, eventId } = await setup();
    const fetcher = vi.fn(async () => new Response("down", { status: 503 }));
    expect(await pushBroadcasts(t.env, eventId, [delivery(ada.id)], fetcher as unknown as typeof fetch)).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();

    t.sqlite.prepare("INSERT INTO device_tokens (id, user_id, platform, token) VALUES ('d1', ?, 'ios', ?)").run(ada.id, TOKEN_A);
    expect(await pushBroadcasts(t.env, eventId, [delivery(ada.id)], fetcher as unknown as typeof fetch)).toBe(0);
    expect(tokens()).toHaveLength(1);
  });
});

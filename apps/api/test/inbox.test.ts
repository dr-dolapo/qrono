import { beforeEach, describe, expect, it } from "vitest";
import { Browser, createTestEnv, tokenFromEmail } from "./helpers/client";

let t: ReturnType<typeof createTestEnv>;
let ada: Browser; // Admin
let adaId: string;
let teamId: string;
const START = "2030-06-01T17:00:00.000Z";

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
  return { browser, userId: (await browser.get("/api/auth/me")).json.user.id as string };
}

const settle = () => new Promise((r) => setTimeout(r, 30));
const inbox = async (b: Browser) => (await b.get("/api/me/inbox")).json as { items: { key: string; kind: string; actions: string[]; ref: Record<string, string>; unread: boolean }[]; unread: number };

beforeEach(async () => {
  t = createTestEnv();
  ada = await person("Ada", "ada@example.com");
  adaId = (await ada.get("/api/auth/me")).json.user.id;
  teamId = (await ada.post("/api/teams", { name: "Events Team", timezone: "Africa/Lagos" })).json.team.id;
});

describe("the Inbox", () => {
  it("shows approvals to the chosen Admin, then parts to confirm once approved, and clears them when handled", async () => {
    const bola = await join("Bola", "bola@example.com", "admin"); // a Planner
    const chi = await join("Chi", "chi@example.com");
    const id = (await bola.browser.post(`/api/teams/${teamId}/events`, { name: "Monday Meeting", startAt: START })).json.event.id;
    await bola.browser.post(`/api/events/${id}/tasks`, { title: "Opening prayer", durationMinutes: 15, who: [{ userId: chi.userId }] });
    await bola.browser.post(`/api/events/${id}/submit`, { approverIds: [adaId] });

    let mine = await inbox(ada);
    expect(mine.items.map((i) => i.key)).toEqual([`approve:${id}`]);
    expect(mine.unread).toBe(1);
    expect(mine.items[0]!.actions).toEqual(["approve", "open"]);

    // Approving from the Inbox is the normal approve call; the item then leaves.
    await ada.post(`/api/events/${id}/approve`);
    await settle();
    expect((await inbox(ada)).items).toEqual([]);

    // Bola hears it was approved; Chi has a part to confirm.
    expect((await inbox(bola.browser)).items[0]).toMatchObject({ kind: "program_approved", actions: ["open", "dismiss"] });
    const chis = await inbox(chi.browser);
    expect(chis.items[0]).toMatchObject({ kind: "confirm", actions: ["confirm", "decline_part", "open"] });
    await chi.browser.post(`/api/events/${id}/response`, { response: "acknowledged" });
    expect((await inbox(chi.browser)).items).toEqual([]);
  });

  it("keeps the unread count separate from the items, and lets notes be dismissed", async () => {
    const bola = await join("Bola", "bola@example.com", "admin");
    const id = (await bola.browser.post(`/api/teams/${teamId}/events`, { name: "Monday Meeting", startAt: START })).json.event.id;
    const task = (await bola.browser.post(`/api/events/${id}/tasks`, { title: "Welcome", durationMinutes: 15, who: [{ userId: bola.userId }] })).json.tasks[0];
    await ada.post(`/api/events/${id}/tasks/${task.id}/comments`, { body: "Keep it short, please." });
    await settle();

    const before = await inbox(bola.browser);
    expect(before.items[0]).toMatchObject({ kind: "comment", unread: true });
    const read = (await bola.browser.post("/api/me/inbox/read", {})).json;
    expect(read.unread).toBe(0);
    expect(read.items).toHaveLength(1);
    const after = (await bola.browser.post(`/api/me/inbox/notes/${before.items[0]!.ref.noteId}/done`)).json;
    expect(after.items).toEqual([]);
  });

  it("shows join requests to Admins and Planners, and team invitations to people who already use Qrono", async () => {
    const { url } = (await ada.post(`/api/teams/${teamId}/invite-link`)).json;
    const dayo = await person("Dayo", "dayo@example.com");
    await dayo.post(`/api/invites/${url.split("/invite/")[1]}/accept`);
    expect((await inbox(ada)).items[0]).toMatchObject({ kind: "join", actions: ["let_in", "decline_join"] });

    // Another team invites Dayo by email: it waits in his Inbox, and he can join from there.
    const eve = await person("Eve", "eve@example.com");
    const other = (await eve.post("/api/teams", { name: "Choir" })).json.team.id;
    await eve.post(`/api/teams/${other}/invites`, { email: "dayo@example.com", role: "member" });
    const item = (await inbox(dayo)).items.find((i) => i.kind === "invite")!;
    expect(item.actions).toEqual(["join_team", "decline_invite"]);
    expect((await dayo.post(`/api/me/invites/${item.ref.inviteId}/accept`)).json.team).toMatchObject({ name: "Choir", status: "active" });
    expect((await inbox(dayo)).items.some((i) => i.kind === "invite")).toBe(false);
  });

  it("lets people change their name", async () => {
    const res = await ada.request("PATCH", "/api/auth/me", { firstName: "Adaeze", lastName: "Obi" });
    expect(res.json.user).toMatchObject({ firstName: "Adaeze", lastName: "Obi" });
    expect((await ada.get("/api/auth/me")).json.user.firstName).toBe("Adaeze");
  });
});

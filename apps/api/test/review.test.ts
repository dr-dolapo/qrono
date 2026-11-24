import { beforeEach, describe, expect, it } from "vitest";
import { Browser, createTestEnv, tokenFromEmail } from "./helpers/client";

let t: ReturnType<typeof createTestEnv>;
let teamId: string;
let ada: Browser; // Admin
let adaId: string;
let bola: Browser; // Planner
let chi: { browser: Browser; userId: string }; // Member
let eventId: string;
let chiParticipant: string;
let guestParticipant: string;

const START = "2026-12-01T09:00:00.000Z";
const END = "2026-12-01T12:00:00.000Z";

async function person(first: string, email: string): Promise<Browser> {
  const b = new Browser(t.env);
  await b.post("/api/auth/signup", { firstName: first, lastName: "Test", email, password: "correct horse battery" });
  await b.post("/api/auth/verify-email", { token: tokenFromEmail(t.emails.at(-1)) });
  return b;
}

async function join(first: string, email: string, role: "approver" | "admin" | "member") {
  await ada.post(`/api/teams/${teamId}/invites`, { email, role });
  const token = t.emails.at(-1)!.text.match(/\/invite\/([A-Za-z0-9_-]+)/)![1];
  const browser = await person(first, email);
  await browser.post(`/api/invites/${token}/accept`);
  return { browser, userId: (await browser.get("/api/auth/me")).json.user.id as string };
}

const emailsTo = (to: string) => t.emails.filter((e) => e.to === to);
const guestToken = () => {
  const m = emailsTo("funmi@example.com").at(-1)?.text.match(/\/g\/([A-Za-z0-9_-]+)/);
  if (!m) throw new Error("No guest link email");
  return m[1]!;
};

/** A draft with one member and one guest on the agenda. */
beforeEach(async () => {
  t = createTestEnv();
  ada = await person("Ada", "ada@example.com");
  adaId = (await ada.get("/api/auth/me")).json.user.id;
  teamId = (await ada.post("/api/teams", { name: "Events Team" })).json.team.id;
  bola = (await join("Bola", "bola@example.com", "admin")).browser;
  chi = await join("Chi", "chi@example.com", "member");

  eventId = (await bola.post(`/api/teams/${teamId}/events`, { name: "AGM", startAt: START, endAt: END, timezone: "Africa/Lagos" })).json.event.id;
  chiParticipant = (await bola.post(`/api/events/${eventId}/participants`, { userId: chi.userId })).json.participantId;
  guestParticipant = (await bola.post(`/api/events/${eventId}/participants`, { guestName: "Dr. Funmi Ade", guestEmail: "funmi@example.com" })).json.participantId;
  await bola.post(`/api/events/${eventId}/tasks`, { title: "Opening", durationMinutes: 10, assigneeIds: [chiParticipant] });
  await bola.post(`/api/events/${eventId}/tasks`, { title: "Keynote", durationMinutes: 40, assigneeIds: [guestParticipant] });
});

const submit = (approverIds = [adaId]) => bola.post(`/api/events/${eventId}/submit`, { approverIds });
const taskId = async (title: string) =>
  (await bola.get(`/api/events/${eventId}`)).json.tasks.find((x: { title: string }) => x.title === title).id as string;

describe("sending for review (QR011)", () => {
  it("moves the draft to review, locks it, and emails the chosen Admins", async () => {
    const res = await submit();
    expect(res.status).toBe(200);
    expect(res.json.event.status).toBe("review");
    expect(res.json.approvers).toEqual([{ userId: adaId, name: "Ada Test", approvedAt: null }]);
    expect(res.json.permissions).toMatchObject({ canEdit: false, canWithdraw: true });
    expect(emailsTo("ada@example.com").at(-1)).toMatchObject({ subject: "Please review: AGM" });
    expect((await bola.post(`/api/events/${eventId}/tasks`, { title: "X", durationMinutes: 5 })).status).toBe(409);
  });

  it("requires at least one Admin from the team", async () => {
    expect((await submit([])).json.fields.approverIds).toBe("Choose at least one Admin.");
    expect((await submit([chi.userId])).json.fields.approverIds).toBe("Choose Admins from this team.");
  });

  it("needs an agenda", async () => {
    const empty = (await bola.post(`/api/teams/${teamId}/events`, { name: "Empty", startAt: START, endAt: END, timezone: "UTC" })).json.event.id;
    const res = await bola.post(`/api/events/${empty}/submit`, { approverIds: [adaId] });
    expect(res.json.code).toBe("agenda_empty");
  });

  it("can't be done by a Member", async () => {
    expect((await chi.browser.post(`/api/events/${eventId}/submit`, { approverIds: [adaId] })).status).toBe(403);
  });

  it("can be withdrawn back to draft for changes", async () => {
    await submit();
    const res = await bola.post(`/api/events/${eventId}/withdraw`);
    expect(res.json.event.status).toBe("draft");
    expect(res.json.approvers).toEqual([]);
    expect((await bola.post(`/api/events/${eventId}/tasks`, { title: "Added", durationMinutes: 5 })).status).toBe(201);
    const log = t.sqlite.prepare("SELECT to_status FROM event_status_changes WHERE event_id = ? ORDER BY rowid").all(eventId);
    expect(log.map((r) => (r as { to_status: string }).to_status)).toEqual(["draft", "review", "draft"]);
  });
});

describe("approving (QR016–QR018, QR032, QR044)", () => {
  it("only a chosen Admin can approve", async () => {
    const other = await join("Dayo", "dayo@example.com", "approver");
    await submit();
    expect((await bola.post(`/api/events/${eventId}/approve`)).status).toBe(403);
    expect((await other.browser.post(`/api/events/${eventId}/approve`)).status).toBe(403);
    expect((await bola.get(`/api/events/${eventId}`)).json.permissions.canApprove).toBe(false);
    expect((await ada.get(`/api/events/${eventId}`)).json.permissions.canApprove).toBe(true);
  });

  it("can't approve a draft", async () => {
    expect((await ada.post(`/api/events/${eventId}/approve`)).status).toBe(409);
  });

  it("approves and tells everyone", async () => {
    await submit();
    const res = await ada.post(`/api/events/${eventId}/approve`);
    expect(res.json.event.status).toBe("approved");
    expect(res.json.approvers[0].approvedAt).toBeTruthy();

    // QR017: Planners (not the approver themself)
    expect(emailsTo("bola@example.com").at(-1)).toMatchObject({ subject: "Approved: AGM" });
    expect(emailsTo("ada@example.com").some((e) => e.subject === "Approved: AGM")).toBe(false);

    // QR018 / QR032: team members get their own tasks, in the event's time zone (Lagos = UTC+1)
    const chiEmail = emailsTo("chi@example.com").at(-1)!;
    expect(chiEmail.subject).toBe("You're on the program: AGM");
    expect(chiEmail.text).toContain("10:00 AM  Opening");
    expect(chiEmail.text).not.toContain("Keynote");

    // QR044: guests get a personal link
    const guestEmail = emailsTo("funmi@example.com").at(-1)!;
    expect(guestEmail.text).toContain("10:10 AM  Keynote");
    expect(guestEmail.text).toMatch(/http:\/\/localhost:5173\/g\/[A-Za-z0-9_-]{40,}/);

    const notified = t.sqlite.prepare("SELECT COUNT(*) AS n FROM event_participants WHERE event_id = ? AND notified_at IS NOT NULL").get(eventId);
    expect(notified).toEqual({ n: 2 });
  });
});

describe("comments (QR012–QR015, QR031)", () => {
  it("lets Admins, Planners and assigned Members comment during review", async () => {
    await submit();
    const keynote = await taskId("Keynote");
    await ada.post(`/api/events/${eventId}/tasks/${keynote}/comments`, { body: "Can the keynote be 30 minutes?" });
    await bola.post(`/api/events/${eventId}/tasks/${keynote}/comments`, { body: "Checking with the speaker." });
    const res = await chi.browser.post(`/api/events/${eventId}/tasks/${keynote}/comments`, { body: "I can cover if needed." });
    expect(res.status).toBe(201);
    expect(res.json.comments.map((x: { author: { name: string }; postedDuring: string }) => [x.author.name, x.postedDuring])).toEqual([
      ["Ada Test", "review"],
      ["Bola Test", "review"],
      ["Chi Test", "review"],
    ]);
  });

  it("hides the event from Members who aren't on it", async () => {
    const dayo = await join("Dayo", "dayo@example.com", "member");
    const keynote = await taskId("Keynote");
    expect((await dayo.browser.post(`/api/events/${eventId}/tasks/${keynote}/comments`, { body: "Hi" })).status).toBe(404);
  });

  it("lets people delete only their own comments", async () => {
    const keynote = await taskId("Keynote");
    const posted = await ada.post(`/api/events/${eventId}/tasks/${keynote}/comments`, { body: "First thought" });
    const commentId = posted.json.comments[0].id;
    expect((await bola.request("DELETE", `/api/events/${eventId}/comments/${commentId}`)).status).toBe(404);
    const res = await ada.request("DELETE", `/api/events/${eventId}/comments/${commentId}`);
    expect(res.json.comments).toEqual([]);
    // Kept in the database for history.
    expect(t.sqlite.prepare("SELECT deleted_at IS NOT NULL AS gone FROM comments WHERE id = ?").get(commentId)).toEqual({ gone: 1 });
  });
});

describe("member responses (QR033–QR036)", () => {
  it("only opens once the event is approved", async () => {
    expect((await chi.browser.post(`/api/events/${eventId}/response`, { response: "acknowledged" })).status).toBe(409);
  });

  it("acknowledges or declines with a reason, visible to Planners", async () => {
    await submit();
    await ada.post(`/api/events/${eventId}/approve`);

    const missing = await chi.browser.post(`/api/events/${eventId}/response`, { response: "declined" });
    expect(missing.json.fields.reason).toBe("Tell the team why you can't take part.");

    let res = await chi.browser.post(`/api/events/${eventId}/response`, { response: "declined", reason: "Travelling that week" });
    expect(res.json.me.participant).toMatchObject({ response: "declined", declineReason: "Travelling that week" });

    res = await chi.browser.post(`/api/events/${eventId}/response`, { response: "acknowledged" });
    expect(res.json.me.participant).toMatchObject({ response: "acknowledged", declineReason: null });

    const admin = await bola.get(`/api/events/${eventId}`);
    expect(admin.json.participants.find((p: { id: string }) => p.id === chiParticipant)).toMatchObject({ response: "acknowledged" });
  });

  it("rejects responses from people not on the program", async () => {
    await submit();
    await ada.post(`/api/events/${eventId}/approve`);
    expect((await ada.post(`/api/events/${eventId}/response`, { response: "acknowledged" })).status).toBe(403);
  });
});

describe("guest links (QR044–QR046)", () => {
  beforeEach(async () => {
    await submit();
    await ada.post(`/api/events/${eventId}/approve`);
  });

  it("shows the program and the guest's own tasks without an account", async () => {
    const res = await new Browser(t.env).get(`/api/guest/${guestToken()}`);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ teamName: "Events Team", event: { name: "AGM", timezone: "Africa/Lagos" }, me: { name: "Dr. Funmi Ade", response: "pending" } });
    expect(res.json.program.map((p: { title: string; mine: boolean }) => [p.title, p.mine])).toEqual([
      ["Opening", false],
      ["Keynote", true],
    ]);
  });

  it("lets the guest decline with a reason, and the team sees it", async () => {
    const anon = new Browser(t.env);
    expect((await anon.post(`/api/guest/${guestToken()}/response`, { response: "declined" })).status).toBe(400);
    await anon.post(`/api/guest/${guestToken()}/response`, { response: "declined", reason: "Flight cancelled" });
    const detail = await bola.get(`/api/events/${eventId}`);
    expect(detail.json.participants.find((p: { id: string }) => p.id === guestParticipant)).toMatchObject({
      response: "declined",
      declineReason: "Flight cancelled",
    });
  });

  it("stops working when the event ends", async () => {
    t.sqlite.exec("UPDATE guest_access_links SET expires_at = '2000-01-01T00:00:00.000Z'");
    const res = await new Browser(t.env).get(`/api/guest/${guestToken()}`);
    expect(res.status).toBe(410);
    expect(res.json.code).toBe("link_expired");
  });

  it("rejects made-up and revoked links", async () => {
    expect((await new Browser(t.env).get("/api/guest/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).status).toBe(404);
    t.sqlite.exec("UPDATE guest_access_links SET revoked_at = '2026-11-30T00:00:00.000Z'");
    expect((await new Browser(t.env).get(`/api/guest/${guestToken()}`)).status).toBe(404);
  });

  it("stores only a hash of the link", async () => {
    const row = t.sqlite.prepare("SELECT token_hash FROM guest_access_links").get() as { token_hash: string };
    expect(row.token_hash).not.toBe(guestToken());
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

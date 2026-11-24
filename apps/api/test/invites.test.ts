import { beforeEach, describe, expect, it } from "vitest";
import { Browser, createTestEnv, tokenFromEmail } from "./helpers/client";

let t: ReturnType<typeof createTestEnv>;
let teamId: string;
let owner: Browser;

/** Sign up and confirm a user; returns their logged-in browser. */
async function person(first: string, email: string): Promise<Browser> {
  const b = new Browser(t.env);
  await b.post("/api/auth/signup", { firstName: first, lastName: "Test", email, password: "correct horse battery" });
  await b.post("/api/auth/verify-email", { token: tokenFromEmail(t.emails.at(-1)) });
  return b;
}

function inviteToken(): string {
  const match = t.emails.at(-1)?.text.match(/\/invite\/([A-Za-z0-9_-]+)/);
  if (!match) throw new Error("No invite link in last email");
  return match[1]!;
}

async function members(b: Browser) {
  return (await b.get(`/api/teams/${teamId}/members`)).json;
}

async function inviteAndJoin(email: string, role: "approver" | "admin" | "member", first = "Bola"): Promise<Browser> {
  await owner.post(`/api/teams/${teamId}/invites`, { email, role });
  const token = inviteToken();
  const b = await person(first, email);
  const res = await b.post(`/api/invites/${token}/accept`);
  expect(res.status).toBe(200);
  return b;
}

async function membershipOf(email: string): Promise<string> {
  const list = await members(owner);
  return list.members.find((m: { user: { email: string } }) => m.user.email === email).id;
}

beforeEach(async () => {
  t = createTestEnv();
  owner = await person("Ada", "ada@example.com");
  teamId = (await owner.post("/api/teams", { name: "Events Team" })).json.team.id;
});

describe("email invites (QR007)", () => {
  it("emails a link and shows who invited them before sign-in", async () => {
    const res = await owner.post(`/api/teams/${teamId}/invites`, { email: "Bola@Example.com", role: "admin" });
    expect(res.status).toBe(201);
    expect(t.emails.at(-1)).toMatchObject({ to: "bola@example.com", subject: "Ada Test invited you to Events Team on Qrono" });

    const info = await new Browser(t.env).get(`/api/invites/${inviteToken()}`);
    expect(info.json.invite).toMatchObject({ teamName: "Events Team", invitedBy: "Ada Test", role: "admin", email: "bola@example.com", needsApproval: false });
  });

  it("joins straight away with the invited role, and the link can't be reused", async () => {
    await owner.post(`/api/teams/${teamId}/invites`, { email: "bola@example.com", role: "admin" });
    const token = inviteToken();
    const bola = await person("Bola", "bola@example.com");

    const res = await bola.post(`/api/invites/${token}/accept`);
    expect(res.json.team).toMatchObject({ name: "Events Team", role: "admin", status: "active" });
    expect((await bola.get("/api/auth/me")).json.teams).toHaveLength(1);
    expect((await bola.post(`/api/invites/${token}/accept`)).status).toBe(410);
  });

  it("must be accepted by the invited email's account", async () => {
    await owner.post(`/api/teams/${teamId}/invites`, { email: "bola@example.com", role: "member" });
    const token = inviteToken();
    const someoneElse = await person("Chi", "chi@example.com");
    const res = await someoneElse.post(`/api/invites/${token}/accept`);
    expect(res.status).toBe(403);
    expect(res.json.code).toBe("invite_wrong_account");
  });

  it("requires a confirmed email to accept", async () => {
    await owner.post(`/api/teams/${teamId}/invites`, { email: "bola@example.com", role: "member" });
    const token = inviteToken();
    const bola = new Browser(t.env);
    await bola.post("/api/auth/signup", { firstName: "Bola", lastName: "T", email: "bola@example.com", password: "correct horse battery" });
    expect((await bola.post(`/api/invites/${token}/accept`)).status).toBe(403);
  });

  it("re-inviting replaces the earlier invitation", async () => {
    await owner.post(`/api/teams/${teamId}/invites`, { email: "bola@example.com", role: "member" });
    const first = inviteToken();
    await owner.post(`/api/teams/${teamId}/invites`, { email: "bola@example.com", role: "admin" });
    expect((await owner.get(`/api/invites/${first}`)).status).toBe(404);
    expect((await owner.get(`/api/teams/${teamId}/invites`)).json.invites).toHaveLength(1);
  });

  it("rejects expired and cancelled invitations", async () => {
    await owner.post(`/api/teams/${teamId}/invites`, { email: "bola@example.com", role: "member" });
    const token = inviteToken();
    t.sqlite.exec("UPDATE team_invites SET expires_at = '2000-01-01T00:00:00.000Z'");
    expect((await owner.get(`/api/invites/${token}`)).json.code).toBe("invite_expired");

    await owner.post(`/api/teams/${teamId}/invites`, { email: "chi@example.com", role: "member" });
    const token2 = inviteToken();
    const inviteId = (await owner.get(`/api/teams/${teamId}/invites`)).json.invites[0].id;
    expect((await owner.request("DELETE", `/api/teams/${teamId}/invites/${inviteId}`)).status).toBe(200);
    expect((await owner.get(`/api/invites/${token2}`)).status).toBe(404);
  });

  it("won't invite someone already on the team", async () => {
    await inviteAndJoin("bola@example.com", "member");
    const res = await owner.post(`/api/teams/${teamId}/invites`, { email: "bola@example.com", role: "member" });
    expect(res.status).toBe(409);
  });

  it("only lets Admins and Planners invite, and only Admins invite Admins", async () => {
    const member = await inviteAndJoin("bola@example.com", "member");
    expect((await member.post(`/api/teams/${teamId}/invites`, { email: "x@example.com", role: "member" })).status).toBe(403);

    const admin = await inviteAndJoin("chi@example.com", "admin", "Chi");
    expect((await admin.post(`/api/teams/${teamId}/invites`, { email: "x@example.com", role: "member" })).status).toBe(201);
    expect((await admin.post(`/api/teams/${teamId}/invites`, { email: "y@example.com", role: "approver" })).status).toBe(403);
  });

  it("hides the team from people who aren't on it", async () => {
    const outsider = await person("Eve", "eve@example.com");
    expect((await outsider.get(`/api/teams/${teamId}/members`)).status).toBe(404);
    expect((await outsider.post(`/api/teams/${teamId}/invites`, { email: "x@example.com", role: "member" })).status).toBe(404);
  });
});

describe("invite link and vetting (QR001)", () => {
  async function linkToken(): Promise<string> {
    const res = await owner.post(`/api/teams/${teamId}/invite-link`);
    expect(res.status).toBe(201);
    return res.json.url.split("/invite/")[1];
  }

  it("joins as a Member waiting for approval and emails the managers", async () => {
    const token = await linkToken();
    const info = await new Browser(t.env).get(`/api/invites/${token}`);
    expect(info.json.invite).toMatchObject({ channel: "link", role: "member", needsApproval: true, email: null });

    const bola = await person("Bola", "bola@example.com");
    const before = t.emails.length;
    const res = await bola.post(`/api/invites/${token}/accept`);
    expect(res.json.team).toMatchObject({ role: "member", status: "pending_vetting" });
    expect(t.emails.slice(before)).toEqual([expect.objectContaining({ to: "ada@example.com", subject: "Bola Test wants to join Events Team" })]);

    // Not in yet: can't see the team.
    expect((await bola.get(`/api/teams/${teamId}/members`)).status).toBe(404);
    expect((await bola.get("/api/auth/me")).json.teams[0].status).toBe("pending_vetting");
  });

  it("can be used by several people", async () => {
    const token = await linkToken();
    for (const [name, email] of [["Bola", "bola@example.com"], ["Chi", "chi@example.com"]] as const) {
      const b = await person(name, email);
      expect((await b.post(`/api/invites/${token}/accept`)).json.team.status).toBe("pending_vetting");
    }
    const list = await members(owner);
    expect(list.members.filter((m: { status: string }) => m.status === "pending_vetting")).toHaveLength(2);
  });

  it("lets a manager approve a join request", async () => {
    const token = await linkToken();
    const bola = await person("Bola", "bola@example.com");
    await bola.post(`/api/invites/${token}/accept`);
    const id = await membershipOf("bola@example.com");

    expect((await owner.post(`/api/teams/${teamId}/members/${id}/approve`)).status).toBe(200);
    expect((await bola.get(`/api/teams/${teamId}/members`)).status).toBe(200);
    expect((await owner.post(`/api/teams/${teamId}/members/${id}/approve`)).status).toBe(409);
  });

  it("lets a manager decline a join request", async () => {
    const token = await linkToken();
    const bola = await person("Bola", "bola@example.com");
    await bola.post(`/api/invites/${token}/accept`);
    const id = await membershipOf("bola@example.com");
    expect((await owner.request("DELETE", `/api/teams/${teamId}/members/${id}`)).status).toBe(200);
    expect((await bola.get("/api/auth/me")).json.teams).toEqual([]);
  });

  it("a new link turns off the old one", async () => {
    const old = await linkToken();
    await linkToken();
    expect((await owner.get(`/api/invites/${old}`)).status).toBe(404);
  });

  it("hides join requests from Members", async () => {
    const member = await inviteAndJoin("bola@example.com", "member");
    const token = await linkToken();
    const chi = await person("Chi", "chi@example.com");
    await chi.post(`/api/invites/${token}/accept`);
    const list = await members(member);
    expect(list.members.map((m: { user: { email: string } }) => m.user.email)).not.toContain("chi@example.com");
  });
});

describe("roles and removal (QR009)", () => {
  it("lets a manager change a member's role", async () => {
    await inviteAndJoin("bola@example.com", "member");
    const id = await membershipOf("bola@example.com");
    const res = await owner.request("PATCH", `/api/teams/${teamId}/members/${id}`, { role: "admin" });
    expect(res.json.member.role).toBe("admin");
  });

  it("stops Planners from creating or changing Admins", async () => {
    const admin = await inviteAndJoin("bola@example.com", "admin");
    await inviteAndJoin("chi@example.com", "member", "Chi");
    const chiId = await membershipOf("chi@example.com");
    const adaId = await membershipOf("ada@example.com");

    expect((await admin.request("PATCH", `/api/teams/${teamId}/members/${chiId}`, { role: "approver" })).status).toBe(403);
    expect((await admin.request("PATCH", `/api/teams/${teamId}/members/${adaId}`, { role: "member" })).status).toBe(403);
    expect((await admin.request("DELETE", `/api/teams/${teamId}/members/${adaId}`)).status).toBe(403);
    // Only Admins change roles; Planners can remove Members, and add Members only.
    expect((await admin.request("PATCH", `/api/teams/${teamId}/members/${chiId}`, { role: "admin" })).status).toBe(403);
    expect((await admin.post(`/api/teams/${teamId}/invites`, { email: "dayo@example.com", role: "admin" })).status).toBe(403);
    expect((await admin.post(`/api/teams/${teamId}/invites`, { email: "dayo@example.com", role: "member" })).status).toBe(201);
    expect((await admin.request("DELETE", `/api/teams/${teamId}/members/${chiId}`)).status).toBe(200);
  });

  it("lets Admins move people up and down", async () => {
    await inviteAndJoin("bola@example.com", "admin");
    const bolaId = await membershipOf("bola@example.com");
    expect((await owner.request("PATCH", `/api/teams/${teamId}/members/${bolaId}`, { role: "approver" })).status).toBe(200);
    expect((await owner.request("PATCH", `/api/teams/${teamId}/members/${bolaId}`, { role: "member" })).status).toBe(200);
  });

  it("stops Members from managing anyone", async () => {
    const member = await inviteAndJoin("bola@example.com", "member");
    const adaId = await membershipOf("ada@example.com");
    expect((await member.request("PATCH", `/api/teams/${teamId}/members/${adaId}`, { role: "member" })).status).toBe(403);
    expect((await member.request("DELETE", `/api/teams/${teamId}/members/${adaId}`)).status).toBe(403);
  });

  it("always keeps at least one Admin", async () => {
    const adaId = await membershipOf("ada@example.com");
    const demote = await owner.request("PATCH", `/api/teams/${teamId}/members/${adaId}`, { role: "admin" });
    expect(demote.status).toBe(409);
    expect(demote.json.code).toBe("last_approver");
    expect((await owner.request("DELETE", `/api/teams/${teamId}/members/${adaId}`)).status).toBe(409);

    // With a second Admin, Ada can step down.
    await inviteAndJoin("bola@example.com", "approver");
    expect((await owner.request("PATCH", `/api/teams/${teamId}/members/${adaId}`, { role: "admin" })).status).toBe(200);
  });

  it("lets someone leave a team, and removed members lose access", async () => {
    const bola = await inviteAndJoin("bola@example.com", "member");
    const id = await membershipOf("bola@example.com");
    expect((await bola.request("DELETE", `/api/teams/${teamId}/members/${id}`)).status).toBe(200);
    expect((await bola.get(`/api/teams/${teamId}/members`)).status).toBe(404);
  });

  it("can re-invite someone who was removed", async () => {
    await inviteAndJoin("bola@example.com", "member");
    const id = await membershipOf("bola@example.com");
    await owner.request("DELETE", `/api/teams/${teamId}/members/${id}`);
    await owner.post(`/api/teams/${teamId}/invites`, { email: "bola@example.com", role: "admin" });
    const token = inviteToken();
    const bola = new Browser(t.env);
    await bola.post("/api/auth/login", { email: "bola@example.com", password: "correct horse battery" });
    const res = await bola.post(`/api/invites/${token}/accept`);
    expect(res.json.team).toMatchObject({ role: "admin", status: "active" });
  });
});

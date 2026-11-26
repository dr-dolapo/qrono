import { beforeEach, describe, expect, it } from "vitest";
import { Browser, createTestEnv, tokenFromEmail } from "./helpers/client";

let t: ReturnType<typeof createTestEnv>;
const PW = "correct horse battery";

async function person(first: string, email: string): Promise<Browser> {
  const b = new Browser(t.env);
  await b.post("/api/auth/signup", { firstName: first, lastName: "Test", email, password: PW });
  await b.post("/api/auth/verify-email", { token: tokenFromEmail(t.emails.at(-1)) });
  return b;
}

beforeEach(() => {
  t = createTestEnv();
});

describe("deleting an account", () => {
  it("needs the password, wipes personal details, logs out, and frees the email", async () => {
    const ada = await person("Ada", "ada@example.com");
    const id = (await ada.get("/api/auth/me")).json.user.id;
    const team = (await ada.post("/api/teams", { name: "Solo Team" })).json.team.id;

    expect((await ada.post("/api/auth/me/delete", { password: "wrong one" })).status).toBe(403);
    const res = await ada.post("/api/auth/me/delete", { password: PW });
    expect(res.json).toEqual({ ok: true, teamsDeleted: 1 });

    expect((await ada.get("/api/auth/me")).status).toBe(401);
    const row = await t.env.DB.prepare("SELECT first_name, last_name, email, deleted_at FROM users WHERE id = ?").bind(id).first<Record<string, string>>();
    expect(row).toMatchObject({ first_name: "Deleted", last_name: "user", email: `deleted-${id}@deleted.invalid` });
    expect(row!.deleted_at).toBeTruthy();
    // Their team, where they were alone, is gone.
    expect(await t.env.DB.prepare("SELECT COUNT(*) AS n FROM teams WHERE id = ?").bind(team).first("n")).toBe(0);
    // They can't log in, and the address can sign up afresh.
    expect((await new Browser(t.env).post("/api/auth/login", { email: "ada@example.com", password: PW })).status).not.toBe(200);
    expect((await new Browser(t.env).post("/api/auth/signup", { firstName: "Ada", lastName: "New", email: "ada@example.com", password: PW })).status).toBeLessThan(300);
  });

  it("won't leave a team with people but no Admin; works once someone else is Admin", async () => {
    const ada = await person("Ada", "ada@example.com");
    const teamId = (await ada.post("/api/teams", { name: "Events Team" })).json.team.id;
    await ada.post(`/api/teams/${teamId}/invites`, { email: "bola@example.com", role: "member" });
    const token = t.emails.at(-1)!.text.match(/\/invite\/([A-Za-z0-9_-]+)/)![1];
    const bola = await person("Bola", "bola@example.com");
    await bola.post(`/api/invites/${token}/accept`);

    const blocked = await ada.post("/api/auth/me/delete", { password: PW });
    expect(blocked.status).toBe(409);
    expect(blocked.json).toMatchObject({ code: "last_admin", teams: [{ teamId, teamName: "Events Team" }] });

    const members = (await ada.get(`/api/teams/${teamId}/members`)).json.members as { id: string; user: { email: string } }[];
    const bolaMember = members.find((m) => m.user.email === "bola@example.com")!;
    await ada.request("PATCH", `/api/teams/${teamId}/members/${bolaMember.id}`, { role: "approver" });
    expect((await ada.post("/api/auth/me/delete", { password: PW })).json.ok).toBe(true);

    // Bola's team carries on without Ada.
    const after = (await bola.get(`/api/teams/${teamId}/members`)).json.members as { user: { email: string } }[];
    expect(after.map((m) => m.user.email)).toEqual(["bola@example.com"]);
  });
});

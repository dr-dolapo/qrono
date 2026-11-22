import { Hono } from "hono";
import { z } from "zod";
import { currentUser, requireVerifiedUser } from "../auth/session";
import type { AppEnv } from "../env";
import { newId } from "../ids";
import { json } from "../validation";

export const teams = new Hono<AppEnv>()
  .use(requireVerifiedUser)

  /**
   * QR006: create a team. The creator becomes its first Approver,
   * since an Approver has every Admin right plus approval (PRD §6).
   */
  .post(
    "/",
    json(
      z.object({
        name: z
          .string({ error: "Enter a team name." })
          .trim()
          .min(2, { error: "Use at least 2 characters." })
          .max(80, { error: "Use at most 80 characters." }),
      }),
    ),
    async (c) => {
      const user = currentUser(c);
      const { name } = c.req.valid("json");
      const teamId = newId();
      await c.env.DB.batch([
        c.env.DB.prepare("INSERT INTO teams (id, name, created_by) VALUES (?, ?, ?)").bind(teamId, name, user.id),
        c.env.DB.prepare(
          "INSERT INTO team_memberships (id, team_id, user_id, role, status) VALUES (?, ?, ?, 'approver', 'active')",
        ).bind(newId(), teamId, user.id),
      ]);
      return c.json({ team: { id: teamId, name, role: "approver", status: "active" } }, 201);
    },
  )

  /** QR010: every team the user belongs to. */
  .get("/", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT t.id, t.name, m.role, m.status
         FROM team_memberships m JOIN teams t ON t.id = m.team_id
        WHERE m.user_id = ? AND m.status <> 'removed'
        ORDER BY t.created_at`,
    )
      .bind(currentUser(c).id)
      .all();
    return c.json({ teams: results });
  });

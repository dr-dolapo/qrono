import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { DUMMY_PASSWORD_HASH, hashPassword, newSecretToken, sha256Hex, verifyPassword } from "../auth/crypto";
import { currentUser, endSession, inBackground, requireUser, startSession } from "../auth/session";
import type { AppEnv } from "../env";
import { newId, nowIso } from "../ids";
import { passwordResetEmail, sendEmail, verificationEmail } from "../mail";
import { emailField, json, nameField, newPasswordField, tokenField } from "../validation";

type Purpose = "email_verification" | "password_reset";
const TOKEN_TTL_MS: Record<Purpose, number> = {
  email_verification: 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
};

interface UserRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  email_verified_at: string | null;
  password_hash: string;
}

/** Issue a one-time token, replacing any unused one for the same purpose. Returns the raw token. */
async function issueToken(c: Context<AppEnv>, userId: string, purpose: Purpose): Promise<string> {
  const token = newSecretToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS[purpose]).toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM auth_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL").bind(userId, purpose),
    c.env.DB.prepare("INSERT INTO auth_tokens (id, user_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)").bind(
      newId(),
      userId,
      purpose,
      await sha256Hex(token),
      expiresAt,
    ),
  ]);
  return token;
}

/** Mark a token used and return its user, or null if it's unknown, used or expired. */
async function consumeToken(c: Context<AppEnv>, token: string, purpose: Purpose): Promise<string | null> {
  const now = nowIso();
  const row = await c.env.DB.prepare(
    `UPDATE auth_tokens SET used_at = ?
      WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?
      RETURNING user_id`,
  )
    .bind(now, await sha256Hex(token), purpose, now)
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

async function sendVerification(c: Context<AppEnv>, user: { id: string; firstName: string; email: string }) {
  const token = await issueToken(c, user.id, "email_verification");
  const link = `${c.env.APP_ORIGIN}/verify-email?token=${encodeURIComponent(token)}`;
  inBackground(c, sendEmail(c.env, { to: user.email, ...verificationEmail(user.firstName, link) }));
}

export const auth = new Hono<AppEnv>()
  /** QR002: create an account. Signs the user in and emails a verification link. */
  .post(
    "/signup",
    json(
      z.object({
        firstName: nameField("first name"),
        lastName: nameField("last name"),
        email: emailField,
        password: newPasswordField,
      }),
    ),
    async (c) => {
      const { firstName, lastName, email, password } = c.req.valid("json");
      const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
      if (existing) {
        return c.json(
          { error: "An account with this email already exists.", fields: { email: "An account with this email already exists. Try logging in." } },
          409,
        );
      }

      const id = newId();
      try {
        await c.env.DB.prepare(
          "INSERT INTO users (id, first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?, ?)",
        )
          .bind(id, firstName, lastName, email, await hashPassword(password))
          .run();
      } catch (err) {
        // Two sign-ups for the same email at the same moment: the second hits the unique index.
        if (String(err).includes("UNIQUE")) {
          return c.json({ error: "An account with this email already exists.", fields: { email: "An account with this email already exists. Try logging in." } }, 409);
        }
        throw err;
      }

      await startSession(c, id);
      await sendVerification(c, { id, firstName, email });
      return c.json({ user: { id, firstName, lastName, email, emailVerified: false } }, 201);
    },
  )

  /** QR003: confirm an email address from the emailed link. */
  .post("/verify-email", json(z.object({ token: tokenField })), async (c) => {
    const userId = await consumeToken(c, c.req.valid("json").token, "email_verification");
    if (!userId) {
      return c.json({ error: "This link is invalid or has expired. Log in to get a new one.", code: "token_invalid" }, 400);
    }
    await c.env.DB.prepare(
      "UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?",
    )
      .bind(nowIso(), nowIso(), userId)
      .run();
    return c.json({ verified: true });
  })

  /** Send a fresh verification link to the signed-in user. */
  .post("/resend-verification", requireUser, async (c) => {
    const user = currentUser(c);
    if (user.emailVerified) return c.json({ alreadyVerified: true });
    await sendVerification(c, user);
    return c.json({ sent: true });
  })

  /** QR004: log in with email and password. */
  .post(
    "/login",
    json(z.object({ email: emailField, password: z.string({ error: "Enter your password." }).min(1, { error: "Enter your password." }).max(200) })),
    async (c) => {
      const { email, password } = c.req.valid("json");
      const user = await c.env.DB.prepare(
        "SELECT id, first_name, last_name, email, email_verified_at, password_hash FROM users WHERE email = ?",
      )
        .bind(email)
        .first<UserRow>();

      // Always run a hash comparison so response time doesn't reveal whether the email exists.
      const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
      if (!user || !ok) return c.json({ error: "That email and password don't match." }, 401);

      await startSession(c, user.id);
      return c.json({
        user: {
          id: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          emailVerified: user.email_verified_at !== null,
        },
      });
    },
  )

  .post("/logout", async (c) => {
    await endSession(c);
    return c.json({ loggedOut: true });
  })

  /** The signed-in user and the teams they belong to. */
  .get("/me", requireUser, async (c) => {
    const user = currentUser(c);
    const { results } = await c.env.DB.prepare(
      `SELECT t.id, t.name, m.role, m.status
         FROM team_memberships m JOIN teams t ON t.id = m.team_id
        WHERE m.user_id = ? AND m.status <> 'removed'
        ORDER BY t.created_at`,
    )
      .bind(user.id)
      .all<{ id: string; name: string; role: string; status: string }>();
    return c.json({ user, teams: results });
  })

  /** QR005: request a password reset link. Always succeeds, so it can't be used to find accounts. */
  .post("/forgot-password", json(z.object({ email: emailField })), async (c) => {
    const user = await c.env.DB.prepare("SELECT id, first_name, email FROM users WHERE email = ?")
      .bind(c.req.valid("json").email)
      .first<{ id: string; first_name: string; email: string }>();
    if (user) {
      const token = await issueToken(c, user.id, "password_reset");
      const link = `${c.env.APP_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`;
      inBackground(c, sendEmail(c.env, { to: user.email, ...passwordResetEmail(user.first_name, link) }));
    }
    return c.json({ sent: true });
  })

  /** QR005: set a new password from the emailed link. Logs out every device. */
  .post("/reset-password", json(z.object({ token: tokenField, password: newPasswordField })), async (c) => {
    const { token, password } = c.req.valid("json");
    const userId = await consumeToken(c, token, "password_reset");
    if (!userId) {
      return c.json({ error: "This reset link is invalid or has expired. Ask for a new one.", code: "token_invalid" }, 400);
    }
    const now = nowIso();
    await c.env.DB.batch([
      // Opening the emailed link proves they control the address, so it counts as verified too.
      c.env.DB.prepare(
        "UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?",
      ).bind(await hashPassword(password), now, now, userId),
      c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    ]);
    return c.json({ reset: true });
  });

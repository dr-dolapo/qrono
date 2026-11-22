import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { z } from "zod";

/**
 * Validates a JSON body and, on failure, returns
 * 400 { error, fields: { fieldName: "message" } } so forms can show errors per field.
 */
export function json<T extends z.ZodType>(schema: T) {
  return zValidator("json" as keyof ValidationTargets, schema, (result, c) => {
    if (!result.success) {
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join(".") || "_";
        fields[key] ??= issue.message;
      }
      return c.json({ error: "Please check the highlighted fields.", fields }, 400);
    }
  });
}

export const emailField = z
  .string({ error: "Enter your email address." })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address." }).max(254, { error: "That email address is too long." }));

export const newPasswordField = z
  .string({ error: "Enter a password." })
  .min(10, { error: "Use at least 10 characters." })
  .max(200, { error: "Use at most 200 characters." });

export const nameField = (label: string) =>
  z
    .string({ error: `Enter your ${label}.` })
    .trim()
    .min(1, { error: `Enter your ${label}.` })
    .max(80, { error: `Your ${label} must be at most 80 characters.` });

export const tokenField = z.string().min(20).max(200);

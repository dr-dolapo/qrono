// Turns the local-development wrangler config into the production one.
// Pure functions (no network), so they're tested in config.test.mjs.
import { applyEdits, modify, parse } from "jsonc-parser";

const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

function set(text, path, value) {
  return applyEdits(text, modify(text, path, value, FORMAT));
}

/**
 * API Worker (apps/api/wrangler.jsonc) for production:
 *  - points at the real D1 database
 *  - sets the public web address (used for email links, cookies and the origin check)
 *  - only keeps the email binding when emails are really being sent
 *  - is reachable only through the web Worker (no public workers.dev URL)
 */
export function productionApiConfig(text, { databaseId, appOrigin, emailMode, mailFrom }) {
  if (!/^[0-9a-f-]{32,36}$/i.test(databaseId)) throw new Error(`Unexpected D1 database ID: ${databaseId}`);
  if (!/^https:\/\/[^/]+$/.test(appOrigin)) throw new Error(`APP_ORIGIN must be https://host with no path, got: ${appOrigin}`);
  if (emailMode !== "log" && emailMode !== "send") throw new Error(`EMAIL_MODE must be "log" or "send", got: ${emailMode}`);
  if (emailMode === "send" && !/<[^@\s]+@[^>\s]+>|^[^@\s]+@[^@\s]+$/.test(mailFrom ?? "")) {
    throw new Error('EMAIL_MODE is "send", so MAIL_FROM must be an address such as "Qrono <no-reply@yourdomain.com>".');
  }

  let out = text;
  out = set(out, ["d1_databases", 0, "database_id"], databaseId);
  out = set(out, ["vars", "APP_ENV"], "production");
  out = set(out, ["vars", "APP_ORIGIN"], appOrigin);
  out = set(out, ["vars", "EMAIL_MODE"], emailMode);
  out = set(out, ["vars", "MAIL_FROM"], mailFrom || "Qrono <no-reply@example.com>");
  if (emailMode !== "send") out = set(out, ["send_email"], undefined);
  out = set(out, ["workers_dev"], false);
  out = set(out, ["preview_urls"], false);

  const errors = [];
  parse(out, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error("Generated API config is not valid JSONC");
  return out;
}

export function readJsonc(text) {
  return parse(text, [], { allowTrailingComma: true });
}

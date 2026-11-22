#!/usr/bin/env node
// Prepares a production deploy. Run by .github/workflows/deploy.yml.
//
//  1. Finds the "qrono-db" D1 database in the Cloudflare account, creating it the first time.
//  2. Works out the web app's public address: APP_ORIGIN if set, otherwise
//     https://qrono-web.<your-subdomain>.workers.dev
//  3. Writes the production values into apps/api/wrangler.jsonc (in the CI checkout only).
//
// Needs: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
// Optional: APP_ORIGIN, EMAIL_MODE ("log" or "send", default "log"), MAIL_FROM.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { productionApiConfig } from "./config.mjs";

// CLOUDFLARE_API_BASE is only for testing this script against a stand-in API.
const API = process.env.CLOUDFLARE_API_BASE ?? "https://api.cloudflare.com/client/v4";
const DB_NAME = "qrono-db";
const WEB_WORKER = "qrono-web";
const apiConfigPath = fileURLToPath(new URL("../../apps/api/wrangler.jsonc", import.meta.url));

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) {
  console.error("Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID. See docs/DEPLOYMENT.md.");
  process.exit(1);
}

async function cf(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const msg = (json.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ") || res.statusText;
    const err = new Error(`Cloudflare API ${method} ${path} failed (${res.status}): ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json.result;
}

async function findOrCreateDatabase() {
  const found = await cf("GET", `/accounts/${account}/d1/database?name=${DB_NAME}`);
  const existing = (found ?? []).find((d) => d.name === DB_NAME);
  if (existing) {
    console.log(`D1 database "${DB_NAME}" found.`);
    return existing.uuid;
  }
  console.log(`Creating D1 database "${DB_NAME}"…`);
  const created = await cf("POST", `/accounts/${account}/d1/database`, { name: DB_NAME });
  return created.uuid;
}

async function appOrigin() {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, "");
  try {
    const { subdomain } = await cf("GET", `/accounts/${account}/workers/subdomain`);
    if (subdomain) return `https://${WEB_WORKER}.${subdomain}.workers.dev`;
  } catch (err) {
    console.error(String(err.message));
  }
  throw new Error(
    "Couldn't find your workers.dev subdomain. Open Workers & Pages in the Cloudflare dashboard once to choose one, " +
      "or set the APP_ORIGIN repository variable to your own domain (see docs/DEPLOYMENT.md).",
  );
}

try {
  const databaseId = await findOrCreateDatabase();
  const origin = await appOrigin();
  const emailMode = process.env.EMAIL_MODE || "log";
  const config = productionApiConfig(readFileSync(apiConfigPath, "utf8"), {
    databaseId,
    appOrigin: origin,
    emailMode,
    mailFrom: process.env.MAIL_FROM,
  });
  writeFileSync(apiConfigPath, config);
  console.log(`Production config written. Web app: ${origin} · emails: ${emailMode}`);

  // Hand the address to later workflow steps.
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `app_origin=${origin}\nemail_mode=${emailMode}\n`);
} catch (err) {
  console.error(`\n✖ ${err.message}`);
  if (err.status === 401 || err.status === 403) {
    console.error("  Check the API token's permissions: Workers Scripts Edit, D1 Edit and Account Settings Read (see docs/DEPLOYMENT.md).");
  }
  process.exit(1);
}

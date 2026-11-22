import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { productionApiConfig, readJsonc } from "./config.mjs";

const dev = readFileSync(new URL("../../apps/api/wrangler.jsonc", import.meta.url), "utf8");
const ok = {
  databaseId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
  appOrigin: "https://qrono-web.example.workers.dev",
  emailMode: "log",
};

test("fills in production values and keeps everything else", () => {
  const out = readJsonc(productionApiConfig(dev, ok));
  const before = readJsonc(dev);
  assert.equal(out.d1_databases[0].database_id, ok.databaseId);
  assert.equal(out.d1_databases[0].database_name, "qrono-db");
  assert.deepEqual(out.vars, {
    APP_ENV: "production",
    APP_ORIGIN: ok.appOrigin,
    EMAIL_MODE: "log",
    MAIL_FROM: "Qrono <no-reply@example.com>",
  });
  assert.deepEqual(out.durable_objects, before.durable_objects);
  assert.deepEqual(out.migrations, before.migrations);
  assert.equal(out.main, before.main);
});

test("keeps the API off the public internet (only reachable through the web app)", () => {
  const out = readJsonc(productionApiConfig(dev, ok));
  assert.equal(out.workers_dev, false);
  assert.equal(out.preview_urls, false);
});

test("drops the email binding until emails are really sent", () => {
  assert.equal(readJsonc(productionApiConfig(dev, ok)).send_email, undefined);
  const sending = readJsonc(productionApiConfig(dev, { ...ok, emailMode: "send", mailFrom: "Qrono <no-reply@qrono.app>" }));
  assert.deepEqual(sending.send_email, [{ name: "EMAIL" }]);
  assert.equal(sending.vars.MAIL_FROM, "Qrono <no-reply@qrono.app>");
});

test("refuses bad settings instead of deploying something broken", () => {
  assert.throws(() => productionApiConfig(dev, { ...ok, appOrigin: "http://insecure.example" }), /APP_ORIGIN/);
  assert.throws(() => productionApiConfig(dev, { ...ok, appOrigin: "https://x.example/path" }), /APP_ORIGIN/);
  assert.throws(() => productionApiConfig(dev, { ...ok, emailMode: "smtp" }), /EMAIL_MODE/);
  assert.throws(() => productionApiConfig(dev, { ...ok, emailMode: "send" }), /MAIL_FROM/);
  assert.throws(() => productionApiConfig(dev, { ...ok, databaseId: "REPLACE_WITH_D1_DATABASE_ID" }), /database ID/);
});

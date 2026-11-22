/**
 * Applies the D1 migrations to an in-memory SQLite database and checks the
 * business rules the schema enforces (PRD §10). D1 is SQLite, so this
 * catches SQL errors and constraint mistakes without a Cloudflare account.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";

const migrationsDir = join(import.meta.dirname, "..", "migrations");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
  return db;
}

let db: DatabaseSync;

beforeEach(() => {
  db = freshDb();
  db.exec(`
    INSERT INTO users (id, first_name, last_name, email, password_hash)
      VALUES ('u1', 'Ada', 'Admin', 'ada@example.com', 'x');
    INSERT INTO teams (id, name, created_by) VALUES ('t1', 'Events Team', 'u1');
    INSERT INTO team_memberships (id, team_id, user_id, role) VALUES ('m1', 't1', 'u1', 'approver');
    INSERT INTO events (id, team_id, name, start_at, end_at, timezone, created_by)
      VALUES ('e1', 't1', 'AGM', '2026-12-01T09:00:00.000Z', '2026-12-01T12:00:00.000Z', 'Africa/Lagos', 'u1');
  `);
});

describe("schema", () => {
  it("creates all 19 tables from the data model", () => {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual([
      "broadcast_receipts",
      "broadcast_targets",
      "broadcasts",
      "comments",
      "device_tokens",
      "event_approvers",
      "event_participants",
      "event_series",
      "event_status_changes",
      "events",
      "guest_access_links",
      "notifications",
      "stages",
      "task_assignments",
      "tasks",
      "team_invites",
      "team_memberships",
      "teams",
      "users",
    ]);
  });

  it("defaults new events to draft with manual progression", () => {
    const e = db.prepare("SELECT status, progression_mode FROM events WHERE id = 'e1'").get();
    expect(e).toEqual({ status: "draft", progression_mode: "manual" });
  });

  it("rejects an event that ends before it starts", () => {
    expect(() =>
      db.exec(`INSERT INTO events (id, team_id, name, start_at, end_at, timezone, created_by)
        VALUES ('e2', 't1', 'Bad', '2026-12-01T12:00:00.000Z', '2026-12-01T09:00:00.000Z', 'Africa/Lagos', 'u1')`),
    ).toThrow(/CHECK/);
  });

  it("only lets invite links join people as Members (QR001)", () => {
    expect(() =>
      db.exec(`INSERT INTO team_invites (id, team_id, channel, role, token_hash, expires_at, created_by)
        VALUES ('i1', 't1', 'link', 'admin', 'h1', '2026-12-31T00:00:00.000Z', 'u1')`),
    ).toThrow(/CHECK/);
    db.exec(`INSERT INTO team_invites (id, team_id, channel, role, token_hash, expires_at, created_by)
      VALUES ('i2', 't1', 'link', 'member', 'h2', '2026-12-31T00:00:00.000Z', 'u1')`);
  });

  it("requires a participant to be either a user or a guest, not both", () => {
    db.exec(`INSERT INTO event_participants (id, event_id, user_id) VALUES ('p1', 'e1', 'u1')`);
    db.exec(`INSERT INTO event_participants (id, event_id, guest_name, guest_email)
      VALUES ('p2', 'e1', 'Guest Speaker', 'guest@example.com')`);
    expect(() =>
      db.exec(`INSERT INTO event_participants (id, event_id, user_id, guest_name, guest_email)
        VALUES ('p3', 'e1', 'u1', 'X', 'x@example.com')`),
    ).toThrow(/CHECK/);
    expect(() => db.exec(`INSERT INTO event_participants (id, event_id) VALUES ('p4', 'e1')`)).toThrow(/CHECK/);
  });

  it("requires a reason when a participant declines (QR035)", () => {
    expect(() =>
      db.exec(`INSERT INTO event_participants (id, event_id, user_id, response)
        VALUES ('p1', 'e1', 'u1', 'declined')`),
    ).toThrow(/CHECK/);
  });

  it("allows only one active personal link per guest", () => {
    db.exec(`INSERT INTO event_participants (id, event_id, guest_name, guest_email)
      VALUES ('p2', 'e1', 'Guest Speaker', 'guest@example.com')`);
    db.exec(`INSERT INTO guest_access_links (id, participant_id, token_hash, expires_at)
      VALUES ('g1', 'p2', 'tok1', '2026-12-01T12:00:00.000Z')`);
    expect(() =>
      db.exec(`INSERT INTO guest_access_links (id, participant_id, token_hash, expires_at)
        VALUES ('g2', 'p2', 'tok2', '2026-12-01T12:00:00.000Z')`),
    ).toThrow(/UNIQUE/);
    db.exec(`UPDATE guest_access_links SET revoked_at = '2026-11-30T00:00:00.000Z' WHERE id = 'g1'`);
    db.exec(`INSERT INTO guest_access_links (id, participant_id, token_hash, expires_at)
      VALUES ('g3', 'p2', 'tok3', '2026-12-01T12:00:00.000Z')`);
  });

  it("lets a task run on all stages (no stage) or on one stage", () => {
    db.exec(`INSERT INTO stages (id, event_id, name) VALUES ('s1', 'e1', 'Adire Hall')`);
    db.exec(`INSERT INTO tasks (id, event_id, stage_id, title, planned_start_at, duration_minutes)
      VALUES ('k1', 'e1', NULL, 'Opening', '2026-12-01T09:00:00.000Z', 5),
             ('k2', 'e1', 's1', 'Break-out I', '2026-12-01T09:05:00.000Z', 30)`);
    expect(() =>
      db.exec(`INSERT INTO tasks (id, event_id, title, planned_start_at, duration_minutes)
        VALUES ('k3', 'e1', 'Zero', '2026-12-01T09:00:00.000Z', 0)`),
    ).toThrow(/CHECK/);
  });

  it("requires a broadcast target to be a stage or a participant, not both", () => {
    db.exec(`INSERT INTO stages (id, event_id, name) VALUES ('s1', 'e1', 'Adire Hall')`);
    db.exec(`INSERT INTO broadcasts (id, event_id, sent_by, body, audience)
      VALUES ('b1', 'e1', 'u1', 'Speaker on in 5', 'stages')`);
    db.exec(`INSERT INTO broadcast_targets (id, broadcast_id, stage_id) VALUES ('bt1', 'b1', 's1')`);
    expect(() =>
      db.exec(`INSERT INTO broadcast_targets (id, broadcast_id) VALUES ('bt2', 'b1')`),
    ).toThrow(/CHECK/);
  });

  it("cascades deletes from an event to its agenda", () => {
    db.exec(`INSERT INTO tasks (id, event_id, title, planned_start_at, duration_minutes)
      VALUES ('k1', 'e1', 'Opening', '2026-12-01T09:00:00.000Z', 5)`);
    db.exec(`DELETE FROM events WHERE id = 'e1'`);
    expect(db.prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 0 });
  });
});

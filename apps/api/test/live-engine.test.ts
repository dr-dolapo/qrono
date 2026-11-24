import { beforeEach, describe, expect, it } from "vitest";
import { endEvent, goLive, LiveError, nextTask, snapshot, tick } from "../src/live/engine";
import { createTestDb } from "./helpers/d1";

const START = Date.parse("2026-12-01T09:00:00.000Z");
const END = Date.parse("2026-12-01T10:00:00.000Z");
const min = (n: number) => n * 60_000;

let db: D1Database;
let sqlite: ReturnType<typeof createTestDb>["sqlite"];

function seed(mode: "auto" | "manual" = "manual", status = "approved") {
  sqlite.exec(`
    INSERT INTO users (id, first_name, last_name, email, password_hash) VALUES ('u1', 'Ada', 'Okafor', 'ada@example.com', 'x');
    INSERT INTO teams (id, name, created_by) VALUES ('t1', 'Team', 'u1');
    INSERT INTO events (id, team_id, name, start_at, end_at, timezone, status, progression_mode, created_by)
      VALUES ('e1', 't1', 'AGM', '2026-12-01T09:00:00.000Z', '2026-12-01T10:00:00.000Z', 'Africa/Lagos', '${status}', '${mode}', 'u1');
    INSERT INTO tasks (id, event_id, title, sort_order, planned_start_at, duration_minutes) VALUES
      ('k1', 'e1', 'Opening', 0, '2026-12-01T09:00:00.000Z', 5),
      ('k2', 'e1', 'Keynote', 1, '2026-12-01T09:05:00.000Z', 30),
      ('k3', 'e1', 'Close', 2, '2026-12-01T09:35:00.000Z', 10);
    INSERT INTO event_participants (id, event_id, user_id) VALUES ('p1', 'e1', 'u1');
    INSERT INTO event_participants (id, event_id, guest_name, guest_email) VALUES ('p2', 'e1', 'Dr. Funmi', 'f@example.com');
    INSERT INTO task_assignments (task_id, participant_id, roll_call_order) VALUES ('k2', 'p2', 0), ('k2', 'p1', 1);
    INSERT INTO guest_access_links (id, participant_id, token_hash, expires_at) VALUES ('g1', 'p2', 'h', '2026-12-01T10:00:00.000Z');
  `);
}

const event = () => sqlite.prepare("SELECT status, current_task_id, ended_early_at, ended_early_by FROM events WHERE id = 'e1'").get() as Record<string, unknown>;
const task = (id: string) => sqlite.prepare("SELECT status, actual_start_at, actual_end_at FROM tasks WHERE id = ?").get(id) as Record<string, unknown>;

beforeEach(() => {
  ({ db, sqlite } = createTestDb());
});

describe("going live", () => {
  it("waits until the start time, then starts the first task", async () => {
    seed();
    expect(await tick(db, "e1", START - min(10))).toBe(START);
    expect(event().status).toBe("approved");

    await tick(db, "e1", START + 1000);
    expect(event()).toMatchObject({ status: "live", current_task_id: "k1" });
    expect(task("k1")).toMatchObject({ status: "in_progress", actual_start_at: "2026-12-01T09:00:00.000Z" });
    const log = sqlite.prepare("SELECT from_status, to_status, changed_by FROM event_status_changes").all();
    expect(log).toEqual([{ from_status: "approved", to_status: "live", changed_by: null }]);
  });

  it("can be started early by a Planner", async () => {
    seed();
    await goLive(db, "e1", START - min(5), "u1");
    expect(event().status).toBe("live");
    expect(task("k1").actual_start_at).toBe("2026-12-01T08:55:00.000Z");
  });

  it("won't start an event that isn't approved", async () => {
    seed("manual", "review");
    await expect(goLive(db, "e1", START, "u1")).rejects.toBeInstanceOf(LiveError);
    expect(await tick(db, "e1", START + min(1))).toBeNull();
    expect(event().status).toBe("review");
  });
});

describe("moving through the agenda", () => {
  it("manual mode: waits for a Planner, then hands over and records times", async () => {
    seed("manual");
    await tick(db, "e1", START);
    // Time is up for the opening, but manual mode doesn't move on by itself.
    expect(await tick(db, "e1", START + min(8))).toBe(END);
    expect(event().current_task_id).toBe("k1");

    await nextTask(db, "e1", START + min(8));
    expect(task("k1")).toMatchObject({ status: "done", actual_end_at: "2026-12-01T09:08:00.000Z" });
    expect(task("k2")).toMatchObject({ status: "in_progress", actual_start_at: "2026-12-01T09:08:00.000Z" });
    expect(event().current_task_id).toBe("k2");
  });

  it("after the last task, nothing is current but the event stays live", async () => {
    seed("manual");
    await goLive(db, "e1", START, "u1");
    await nextTask(db, "e1", START + min(5));
    await nextTask(db, "e1", START + min(35));
    await nextTask(db, "e1", START + min(45));
    expect(event()).toMatchObject({ status: "live", current_task_id: null });
    expect(task("k3").status).toBe("done");
    await expect(nextTask(db, "e1", START + min(46))).rejects.toThrow("There are no more tasks.");
  });

  it("auto mode: hands over on time, catching up if it was asleep", async () => {
    seed("auto");
    expect(await tick(db, "e1", START)).toBe(START + min(5));
    // Wakes up late, after both the opening and the keynote should have finished.
    const next = await tick(db, "e1", START + min(36));
    expect(task("k1").actual_end_at).toBe("2026-12-01T09:05:00.000Z");
    expect(task("k2")).toMatchObject({ actual_start_at: "2026-12-01T09:05:00.000Z", actual_end_at: "2026-12-01T09:35:00.000Z" });
    expect(event().current_task_id).toBe("k3");
    expect(next).toBe(START + min(45));
  });

  it("auto mode respects a manual early hand-over", async () => {
    seed("auto");
    await tick(db, "e1", START);
    await nextTask(db, "e1", START + min(2)); // the opening finished early
    expect(await tick(db, "e1", START + min(2))).toBe(START + min(32));
  });
});

describe("ending", () => {
  it("a Planner can end early: unfinished tasks are skipped and guest links expire", async () => {
    seed();
    await goLive(db, "e1", START, "u1");
    await endEvent(db, "e1", START + min(20), "u1");
    expect(event()).toMatchObject({ status: "past", current_task_id: null, ended_early_by: "u1", ended_early_at: "2026-12-01T09:20:00.000Z" });
    expect(task("k1")).toMatchObject({ status: "done", actual_end_at: "2026-12-01T09:20:00.000Z" });
    expect(task("k2").status).toBe("skipped");
    const link = sqlite.prepare("SELECT expires_at FROM guest_access_links WHERE id = 'g1'").get();
    expect(link).toEqual({ expires_at: "2026-12-01T09:20:00.000Z" });
  });

  it("ends by itself at the end time", async () => {
    seed("manual");
    await tick(db, "e1", START);
    expect(await tick(db, "e1", END + 1000)).toBeNull();
    expect(event()).toMatchObject({ status: "past", ended_early_at: null });
  });

  it("an approved event whose time has passed goes straight to past", async () => {
    seed();
    await tick(db, "e1", END + min(5));
    expect(event().status).toBe("past");
  });
});

describe("snapshot", () => {
  it("gives screens the agenda, live status and assignees in roll-call order", async () => {
    seed();
    await goLive(db, "e1", START, "u1");
    const s = await snapshot(db, "e1", START + 1000);
    expect(s).toMatchObject({
      type: "state",
      event: { name: "AGM", status: "live", timezone: "Africa/Lagos", progressionMode: "manual" },
      currentTaskId: "k1",
    });
    expect(s.tasks.map((t) => [t.title, t.status, t.assignees])).toEqual([
      ["Opening", "in_progress", []],
      ["Keynote", "upcoming", ["Dr. Funmi", "Ada Okafor"]],
      ["Close", "upcoming", []],
    ]);
  });
});

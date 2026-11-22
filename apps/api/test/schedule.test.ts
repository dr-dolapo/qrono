import { describe, expect, it } from "vitest";
import { buildSchedule } from "../src/events/schedule";

const START = "2026-12-01T09:00:00.000Z";
const END = "2026-12-01T12:00:00.000Z";

/** "09:05" style start times for readable assertions. */
function times(tasks: { id: string; startAt: string; endAt: string }[]) {
  const hhmm = (iso: string) => iso.slice(11, 16);
  return Object.fromEntries(tasks.map((t) => [t.id, `${hhmm(t.startAt)}-${hhmm(t.endAt)}`]));
}

describe("buildSchedule", () => {
  it("runs a single-stage agenda back to back (PRD §8 single-stage example)", () => {
    const s = buildSchedule(START, END, [
      { id: "opening", stageId: null, durationMinutes: 5 },
      { id: "intros", stageId: null, durationMinutes: 15 },
      { id: "keynote", stageId: null, durationMinutes: 35 },
    ]);
    expect(times(s.tasks)).toEqual({ opening: "09:00-09:05", intros: "09:05-09:20", keynote: "09:20-09:55" });
    expect(s.endsAt).toBe("2026-12-01T09:55:00.000Z");
    expect(s.overrunMinutes).toBe(0);
  });

  it("runs stages side by side in parallel", () => {
    const s = buildSchedule(START, END, [
      { id: "a1", stageId: "hall-a", durationMinutes: 30 },
      { id: "b1", stageId: "hall-b", durationMinutes: 20 },
      { id: "a2", stageId: "hall-a", durationMinutes: 30 },
      { id: "b2", stageId: "hall-b", durationMinutes: 20 },
    ]);
    expect(times(s.tasks)).toEqual({ a1: "09:00-09:30", b1: "09:00-09:20", a2: "09:30-10:00", b2: "09:20-09:40" });
  });

  it("splits into breakouts and comes back together (mixed)", () => {
    const s = buildSchedule(START, END, [
      { id: "opening", stageId: null, durationMinutes: 10 },
      { id: "breakout1", stageId: "hall-a", durationMinutes: 40 },
      { id: "qa1", stageId: "hall-a", durationMinutes: 10 },
      { id: "breakout2", stageId: "hall-b", durationMinutes: 30 },
      { id: "conclusions", stageId: null, durationMinutes: 15 },
      { id: "after", stageId: "hall-b", durationMinutes: 5 },
    ]);
    expect(times(s.tasks)).toEqual({
      opening: "09:00-09:10",
      breakout1: "09:10-09:50",
      qa1: "09:50-10:00",
      breakout2: "09:10-09:40",
      // Waits for the longer breakout lane to finish.
      conclusions: "10:00-10:15",
      after: "10:15-10:20",
    });
  });

  it("reports how far the agenda runs past the event end", () => {
    const s = buildSchedule(START, "2026-12-01T09:30:00.000Z", [{ id: "long", stageId: null, durationMinutes: 45 }]);
    expect(s.overrunMinutes).toBe(15);
  });

  it("handles an empty agenda", () => {
    const s = buildSchedule(START, END, []);
    expect(s).toEqual({ tasks: [], endsAt: START, overrunMinutes: 0 });
  });

  it("handles an event that crosses midnight", () => {
    const s = buildSchedule("2026-12-31T22:00:00.000Z", "2027-01-01T02:00:00.000Z", [
      { id: "set", stageId: null, durationMinutes: 150 },
      { id: "encore", stageId: null, durationMinutes: 30 },
    ]);
    expect(s.tasks[1]).toEqual({ id: "encore", startAt: "2027-01-01T00:30:00.000Z", endAt: "2027-01-01T01:00:00.000Z" });
  });
});

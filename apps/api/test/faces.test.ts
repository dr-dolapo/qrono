import { describe, expect, it } from "vitest";
import { allFace, faceProgress, followPlan, formatFace, formatWait, meFace, type FaceInput, type FaceTask } from "../src/live/faces";

const T0 = Date.parse("2030-06-01T17:00:00.000Z");
const min = (n: number) => n * 60_000;
const at = (n: number) => new Date(T0 + min(n)).toISOString();

// Opening prayer 5, Praise 15, Bible reading (mine) 5, The Word 30.
function tasks(statuses: FaceTask["status"][] = ["upcoming", "upcoming", "upcoming", "upcoming"], starts: (string | null)[] = [null, null, null, null]): FaceTask[] {
  const plan = [
    ["a", "Opening prayer", 5, 0],
    ["b", "Praise & worship", 15, 5],
    ["c", "Bible reading", 5, 20],
    ["d", "The Word", 30, 25],
  ] as const;
  return plan.map(([id, title, d, s], i) => ({ id, title, durationMinutes: d, plannedStartAt: at(s), status: statuses[i]!, actualStartAt: starts[i]! }));
}

function input(over: Partial<FaceInput>): FaceInput {
  return { status: "approved", startAt: at(0), tasks: tasks(), currentTaskId: null, mine: new Set(["c"]), warningMs: min(1), now: T0 - min(15), ...over };
}

describe("pushdown faces", () => {
  it("counts down to the start and to your part before the event", () => {
    const all = allFace(input({}));
    expect(all).toMatchObject({ tone: "purple", caption: "The event starts in", target: T0, changesAt: T0 - min(1) });
    const me = meFace(input({}))!;
    expect(me).toMatchObject({ tone: "purple", caption: "Your part · Bible reading", target: T0 + min(20), estimated: false });
    expect(formatFace(me, T0 - min(15))).toBe("35:00");
  });

  it("turns amber inside the team's warning window", () => {
    expect(allFace(input({ now: T0 - 30_000 }))).toMatchObject({ tone: "amber", changesAt: null });
    expect(allFace(input({ now: T0 - 30_000, warningMs: min(2) })).tone).toBe("amber");
    expect(allFace(input({ now: T0 - min(3), warningMs: min(2) })).tone).toBe("purple");
  });

  it("has no Me face for someone without a part", () => {
    expect(meFace(input({ mine: new Set() }))).toBeNull();
  });

  it("shows the item on now, then red and counting up once it runs over", () => {
    const live = input({ status: "live", tasks: tasks(["done", "in_progress", "upcoming", "upcoming"], [at(0), at(5), null, null]), currentTaskId: "b" });
    const mid = allFace({ ...live, now: T0 + min(8) });
    expect(mid).toMatchObject({ tone: "purple", caption: "On now · Praise & worship", target: T0 + min(20), from: T0 + min(5), changesAt: T0 + min(19) });
    expect(faceProgress(mid, T0 + min(8))).toBeCloseTo(0.2);
    expect(allFace({ ...live, now: T0 + min(19.5) })).toMatchObject({ tone: "amber", changesAt: T0 + min(20) });
    const over = allFace({ ...live, now: T0 + min(21) });
    expect(over).toMatchObject({ tone: "red", over: true, caption: "Over time · Praise & worship" });
    expect(formatFace(over, T0 + min(21) + 20_000)).toBe("+01:20");
  });

  it("estimates your part from the item on now and the ones before yours", () => {
    const live = input({ status: "live", tasks: tasks(["in_progress", "upcoming", "upcoming", "upcoming"], [at(0), null, null, null]), currentTaskId: "a", now: T0 + min(2) });
    // 3 min left of the opening, then 15 of praise.
    expect(meFace(live)).toMatchObject({ tone: "purple", estimated: true, target: T0 + min(20), caption: "Your part · Bible reading" });
  });

  it("goes green while you're on, red when you run over, then thanks you", () => {
    const on = input({ status: "live", tasks: tasks(["done", "done", "in_progress", "upcoming"], [at(0), at(5), at(20), null]), currentTaskId: "c" });
    expect(meFace({ ...on, now: T0 + min(22) })).toMatchObject({ tone: "green", caption: "You're on now · Bible reading", changesAt: T0 + min(25) });
    expect(allFace({ ...on, now: T0 + min(22) }).tone).toBe("green");
    expect(meFace({ ...on, now: T0 + min(26) })).toMatchObject({ tone: "red", caption: "Over time · Bible reading" });
    const after = input({ status: "live", tasks: tasks(["done", "done", "done", "in_progress"], [at(0), at(5), at(20), at(25)]), currentTaskId: "d", now: T0 + min(30) });
    expect(meFace(after)).toMatchObject({ caption: "Your part is done", text: "Thank you!", target: null });
    // Every item done (and once it's ended): "Meeting ended".
    const finished = input({ status: "live", tasks: tasks(["done", "done", "done", "done"], [at(0), at(5), at(20), at(25)]), currentTaskId: null, now: T0 + min(56) });
    expect(allFace(finished)).toMatchObject({ caption: "Thank you for joining", text: "Meeting ended" });
    expect(allFace({ ...finished, status: "past" }).text).toBe("Meeting ended");
  });

  it("writes long waits in words", () => {
    expect(formatWait(min(60 * 5 + 20))).toBe("5 h 20 min");
    expect(formatWait(min(60 * 72))).toBe("3 days");
    expect(formatWait(min(4) + 9_000)).toBe("04:09");
  });

  it("follows the plan with no connection: items run to time, one after another", () => {
    // Offline before the start; 22 minutes later the plan says Bible reading (mine) is on.
    const planned = followPlan(input({ now: T0 + min(22) }));
    expect(planned).toMatchObject({ status: "live", currentTaskId: "c" });
    expect(planned.tasks.map((t) => t.status)).toEqual(["done", "done", "in_progress", "upcoming"]);
    expect(planned.tasks[2]!.actualStartAt).toBe(at(20));
    expect(meFace(planned)).toMatchObject({ tone: "green", target: T0 + min(25) });

    // From the last live state: praise started late (at 7), so everything after slides with it.
    const late = input({ status: "live", tasks: tasks(["done", "in_progress", "upcoming", "upcoming"], [at(0), at(7), null, null]), currentTaskId: "b", now: T0 + min(23) });
    expect(followPlan(late)).toMatchObject({ currentTaskId: "c" });
    expect(followPlan(late).tasks[2]!.actualStartAt).toBe(at(22));

    // Nothing to move on yet: unchanged.
    expect(followPlan(input({}))).toEqual(input({}));
  });
});

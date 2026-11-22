/**
 * Works out when every task starts and ends, from the event start time and
 * the order and length of its tasks. Covers the three formats in PRD §8:
 *
 *  - Single stage: tasks run one after another.
 *  - Parallel: each stage has its own lane; its tasks run one after another
 *    in that lane, side by side with the other stages.
 *  - Mixed: a task with no stage ("all stages", e.g. a joint opening) waits
 *    for every lane to finish, then everyone continues from its end — so
 *    breakouts can split off and come back together.
 *
 * Tasks are processed in their agenda order (sort_order).
 */

export interface ScheduleInput {
  id: string;
  stageId: string | null;
  durationMinutes: number;
}

export interface ScheduledTask {
  id: string;
  startAt: string;
  endAt: string;
}

export interface Schedule {
  tasks: ScheduledTask[];
  /** When the last task finishes (the event start if there are no tasks). */
  endsAt: string;
  /** Minutes the agenda runs past the event's end time (0 if it fits). */
  overrunMinutes: number;
}

const MINUTE = 60_000;

export function buildSchedule(eventStartAt: string, eventEndAt: string, tasks: ScheduleInput[]): Schedule {
  const start = Date.parse(eventStartAt);
  let syncPoint = start; // where shared ("all stages") tasks left everyone
  const laneEnds = new Map<string, number>();
  const out: ScheduledTask[] = [];
  let latest = start;

  for (const task of tasks) {
    const duration = task.durationMinutes * MINUTE;
    let taskStart: number;

    if (task.stageId === null) {
      taskStart = Math.max(syncPoint, ...laneEnds.values());
      const taskEnd = taskStart + duration;
      syncPoint = taskEnd;
      for (const stage of laneEnds.keys()) laneEnds.set(stage, taskEnd);
    } else {
      taskStart = Math.max(syncPoint, laneEnds.get(task.stageId) ?? syncPoint);
      laneEnds.set(task.stageId, taskStart + duration);
    }

    const taskEnd = taskStart + duration;
    latest = Math.max(latest, taskEnd);
    out.push({ id: task.id, startAt: new Date(taskStart).toISOString(), endAt: new Date(taskEnd).toISOString() });
  }

  const overrun = Math.max(0, Math.ceil((latest - Date.parse(eventEndAt)) / MINUTE));
  return { tasks: out, endsAt: new Date(latest).toISOString(), overrunMinutes: overrun };
}

import type { EventDetail, MyEvent } from "../events/types";
import { ApiError, apiIfChanged } from "./api";
import { cacheKeys, readCache, removeCache, writeCache } from "./cache";

const DAY = 24 * 60 * 60_000;
const FRESH_FOR = 5 * 60_000;
let running = false;

/**
 * Saves the next 14 days of events (each event, its program and its messages) in the
 * background whenever the Events list loads, so they open instantly and work offline even if
 * they've never been opened. One event at a time, and only what changed, to go easy on data.
 * Also forgets events a day after they end.
 */
export async function saveUpcoming(events: MyEvent[]): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const soon = events.filter((e) => Date.parse(e.endAt) > now && Date.parse(e.startAt) < now + 14 * DAY);
    for (const e of soon) {
      const id = encodeURIComponent(e.id);
      for (const [key, path] of [
        [`event:${e.id}`, `/events/${id}`],
        [`broadcasts:${e.id}`, `/events/${id}/broadcasts`],
      ] as const) {
        const saved = readCache(key);
        if (saved && now - saved.savedAt < FRESH_FOR) continue;
        try {
          const result = await apiIfChanged(path, saved?.etag ?? null);
          if (result.changed) writeCache(key, result.data, result.etag);
          else if (saved) writeCache(key, saved.value, saved.etag);
        } catch (err) {
          if (err instanceof ApiError && err.code === "network") return; // offline: try again next time
        }
      }
    }
    forgetEnded(now);
  } finally {
    running = false;
  }
}

function forgetEnded(now: number) {
  for (const key of cacheKeys()) {
    if (!key.startsWith("event:")) continue;
    const id = key.slice("event:".length);
    const detail = readCache<EventDetail>(key)?.value;
    if (detail && Date.parse(detail.event.endAt) < now - DAY) {
      for (const k of [key, `broadcasts:${id}`, `live:${id}`]) removeCache(k);
    }
  }
}

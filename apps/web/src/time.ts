/**
 * Times are stored in UTC; events are planned and shown in the event's own
 * time zone (e.g. Africa/Lagos), whatever time zone the viewer's computer is in.
 */

/** Minutes the zone is ahead of UTC at a given moment. */
function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - utcMs) / 60_000);
}

/** "2026-12-01T09:00" (wall time in `timeZone`) → UTC ISO string. */
export function fromZonedInput(value: string, timeZone: string): string | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  // Two passes handle daylight-saving changes.
  let utc = wall - zoneOffsetMinutes(wall, timeZone) * 60_000;
  utc = wall - zoneOffsetMinutes(utc, timeZone) * 60_000;
  return new Date(utc).toISOString();
}

/** UTC ISO string → "2026-12-01T09:00" wall time in `timeZone`, for <input type="datetime-local">. */
export function toZonedInput(iso: string, timeZone: string): string {
  const utc = Date.parse(iso);
  const local = new Date(utc + zoneOffsetMinutes(utc, timeZone) * 60_000);
  return local.toISOString().slice(0, 16);
}

export function formatTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString([], { timeZone, hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString([], { timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** "Tue, 1 Dec 2026 · 09:00 – 12:00", or with both dates if it spans days. */
export function formatRange(startIso: string, endIso: string, timeZone: string): string {
  const sameDay = toZonedInput(startIso, timeZone).slice(0, 10) === toZonedInput(endIso, timeZone).slice(0, 10);
  return sameDay
    ? `${formatDate(startIso, timeZone)} · ${formatTime(startIso, timeZone)} – ${formatTime(endIso, timeZone)}`
    : `${formatDate(startIso, timeZone)} ${formatTime(startIso, timeZone)} – ${formatDate(endIso, timeZone)} ${formatTime(endIso, timeZone)}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function allTimeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return [browserTimeZone(), "UTC"];
  }
}

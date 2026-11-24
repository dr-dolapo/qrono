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

/** "6:00 PM", in the event's time zone. One format everywhere in the app. */
export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
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

/** "15 minutes", "1 hour", "1 hour 15 minutes", "2 hours". */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const mins = `${m} minute${m === 1 ? "" : "s"}`;
  if (h === 0) return mins;
  const hours = `${h} hour${h === 1 ? "" : "s"}`;
  return m ? `${hours} ${mins}` : hours;
}

const ordinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
};

/** "Monday 23rd November 2026", in the event's time zone. */
export function formatLongDate(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${ordinal(Number(get("day")))} ${get("month")} ${get("year")}`;
}

/** The zone's short name, e.g. "WAT" or "BST", falling back to "GMT+1" when none is known. */
function zoneAbbreviation(iso: string, timeZone: string): string {
  let fallback = "";
  for (const locale of ["en-US", "en-GB", "en-NG", "en-ZA", "en-KE", "en-IN", "en-AU"]) {
    const name = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" }).formatToParts(new Date(iso)).find((p) => p.type === "timeZoneName")?.value ?? "";
    if (name && !/^(GMT|UTC)[+-]/.test(name)) return name;
    fallback ||= name;
  }
  return fallback;
}

/** "6:00 PM", in the event's time zone. */
export function formatShortClock(iso: string, timeZone: string): string {
  return formatTime(iso, timeZone);
}

/** "6:00 PM WAT", in the event's time zone. */
export function formatClockWithZone(iso: string, timeZone: string): string {
  return `${formatShortClock(iso, timeZone)} ${zoneAbbreviation(iso, timeZone)}`.trim();
}

/** "Mon 7 Dec" in the event's time zone. */
export function formatDayMonth(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

/** Day and short month for a date tile: { day: "7", month: "Dec" }. */
export function dateTile(iso: string, timeZone: string): { day: string; month: string } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" }).formatToParts(new Date(iso));
  return { day: parts.find((p) => p.type === "day")?.value ?? "", month: parts.find((p) => p.type === "month")?.value ?? "" };
}

/** "6:00 – 8:00 PM", dropping the first AM/PM when both match. */
export function formatTimeRange(startIso: string, endIso: string, timeZone: string): string {
  const a = formatTime(startIso, timeZone);
  const b = formatTime(endIso, timeZone);
  const sameHalf = a.slice(-2) === b.slice(-2);
  return `${sameHalf ? a.slice(0, -3) : a} – ${b}`;
}

/** Calendar days from today to the date, counted in the event's time zone. */
function dayNumber(iso: string, timeZone: string): number {
  const [y, m, d] = toZonedInput(iso, timeZone).slice(0, 10).split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
}

/** "today", "tomorrow", "in 13 days", "yesterday", "3 days ago", "2 months ago". */
export function relativeDay(iso: string, timeZone: string, now = new Date()): string {
  const diff = dayNumber(iso, timeZone) - dayNumber(now.toISOString(), timeZone);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  const n = Math.abs(diff);
  const unit = n >= 365 ? [Math.round(n / 365), "year"] : n >= 60 ? [Math.round(n / 30), "month"] : n >= 14 && n % 7 === 0 ? [n / 7, "week"] : [n, "day"];
  const label = `${unit[0]} ${unit[1]}${unit[0] === 1 ? "" : "s"}`;
  return diff > 0 ? `in ${label}` : `${label} ago`;
}

/** "2 hours", "1:05" style length for stat cards: hours and minutes as h:mm. */
export function formatClockLength(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** "6:00 – 8:00 PM WAT", in the event's time zone. */
export function formatTimeRangeWithZone(startIso: string, endIso: string, timeZone: string): string {
  return `${formatTimeRange(startIso, endIso, timeZone)} ${zoneAbbreviation(startIso, timeZone)}`.trim();
}

/** "West Africa Standard Time" for "Africa/Lagos"; falls back to the zone's id. */
export function zoneLongName(timeZone: string, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "long" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/** "6:00 PM WAT", or "6:00 – 8:05 PM WAT" once the agenda gives it an end. */
export function formatWhenWithZone(startIso: string, endIso: string, timeZone: string, hasAgenda: boolean): string {
  return hasAgenda ? formatTimeRangeWithZone(startIso, endIso, timeZone) : formatClockWithZone(startIso, timeZone);
}

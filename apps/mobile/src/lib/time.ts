/**
 * Times are stored in UTC. Events are shown in the event's own time zone (e.g. Africa/Lagos),
 * whatever time zone the phone is in, matching the web app.
 */

function format(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions, locale?: string): string {
  const date = new Date(iso);
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
  } catch {
    // An unknown time zone shouldn't break the screen: fall back to the phone's own.
    return new Intl.DateTimeFormat(locale, options).format(date);
  }
}

/** "6:00 PM", the same format as the web app. */
export const formatTime = (iso: string, tz: string) =>
  format(iso, tz, { hour: "numeric", minute: "2-digit", hour12: true }, "en-US");
export const formatDate = (iso: string, tz: string) =>
  format(iso, tz, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const dayKey = (iso: string, tz: string) => format(iso, tz, { year: "numeric", month: "2-digit", day: "2-digit" });

/** "Tue, 1 Dec 2026 · 10:00 – 13:00", or with both dates if it spans days. */
export function formatRange(startIso: string, endIso: string, tz: string): string {
  return dayKey(startIso, tz) === dayKey(endIso, tz)
    ? `${formatDate(startIso, tz)} · ${formatTime(startIso, tz)} – ${formatTime(endIso, tz)}`
    : `${formatDate(startIso, tz)} ${formatTime(startIso, tz)} – ${formatDate(endIso, tz)} ${formatTime(endIso, tz)}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** The phone's time zone, e.g. "Europe/London". */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** "Africa/Lagos" → "Lagos". */
export function zoneCity(tz: string): string {
  return (tz.split("/").pop() ?? tz).replace(/_/g, " ");
}

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function countdownTo(iso: string, now: number): Countdown | null {
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return null;
  const total = Math.floor(ms / 1000);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** "in 3 days", "in 4 h 12 min", "in 9 min", "now". */
export function shortCountdown(iso: string, now: number): string {
  const c = countdownTo(iso, now);
  if (!c) return "now";
  if (c.days >= 2) return `in ${c.days} days`;
  if (c.days === 1) return `in 1 day ${c.hours} h`;
  if (c.hours > 0) return `in ${c.hours} h ${c.minutes} min`;
  return `in ${Math.max(c.minutes, 1)} min`;
}

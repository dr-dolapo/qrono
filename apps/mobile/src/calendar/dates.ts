/** Calendar days on this phone, as "YYYY-MM-DD" in the phone's own time. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The day an event starts on, in the phone's own time (matches the calendar). */
export const dayOf = (iso: string) => dayKey(new Date(iso));

export function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday of the week containing `d`. */
export function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(x, -((x.getDay() + 6) % 7));
}

export const todayKey = () => dayKey(new Date());

/** "Today", "Tomorrow", "Yesterday", else "Wednesday 2 December". */
export function dayHeading(key: string): string {
  const today = todayKey();
  if (key === today) return "Today";
  if (key === dayKey(addDays(fromKey(today), 1))) return "Tomorrow";
  if (key === dayKey(addDays(fromKey(today), -1))) return "Yesterday";
  return fromKey(key).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export const monthLabel = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
export const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

import { AGENDA_DURATIONS } from "../../../api";
import { durationLabel } from "../../../time";

/** "Duration": picked from the list, never typed (1–15 by 1, to 60 by 5, to 120 by 15). */
export function DurationSelect({ value, onChange, invalid }: { value: number | null; onChange: (minutes: number) => void; invalid?: boolean }) {
  // An older item may have a length that's no longer on the list: keep showing it.
  const options = value && !AGENDA_DURATIONS.includes(value) ? [...AGENDA_DURATIONS, value].sort((a, b) => a - b) : AGENDA_DURATIONS;
  return (
    <select
      className={`agenda-input agenda-select ${value ? "" : "is-empty"}`}
      aria-label="Duration"
      aria-invalid={invalid || undefined}
      value={value ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      <option value="" disabled>
        Choose…
      </option>
      {options.map((m) => (
        <option key={m} value={m}>
          {durationLabel(m)}
        </option>
      ))}
    </select>
  );
}

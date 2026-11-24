import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Alert, SubmitButton, TextField } from "../../components/Form";
import { Icon } from "../../components/Icon";
import { formatTime, fromZonedInput, toZonedInput, zoneLongName } from "../../time";
import { useForm } from "../../useForm";

export interface EventDetailsValues {
  name: string;
  description: string | null;
  startAt: string;
}

/** Every quarter hour of the day, "00:00" … "23:45". */
const QUARTER_HOURS = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);

/** "18:30" → "6:30 PM". */
function clockLabel(hhmm: string): string {
  return formatTime(`2000-01-01T${hhmm}:00.000Z`, "UTC");
}

/**
 * Name, description, and when it starts: a day (today or later) and a time on the
 * quarter hour. There's no end time: the event ends when its agenda does. Times are
 * in the team's time zone, which is changed in Settings, not here.
 */
export function EventDetailsForm({
  initial,
  timeZone,
  canChangeZone,
  submitLabel,
  onSubmit,
  onCancel,
  startLocked = false,
}: {
  initial?: EventDetailsValues;
  /** The zone times are entered in: the team's for a new event, the event's own when editing. */
  timeZone: string;
  /** Show a link to Settings, where the team's time zone is changed. */
  canChangeZone: boolean;
  /** Once an event is live, its start can't change. */
  startLocked?: boolean;
  submitLabel: string;
  onSubmit: (values: EventDetailsValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const initialWall = initial ? toZonedInput(initial.startAt, timeZone) : "";
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [day, setDay] = useState(initialWall.slice(0, 10));
  const [time, setTime] = useState(initialWall.slice(11, 16));
  const form = useForm();

  // "Now" in the event's time zone, to keep the day and time from being in the past.
  const nowWall = toZonedInput(new Date().toISOString(), timeZone);
  const today = nowWall.slice(0, 10);
  const nowTime = nowWall.slice(11, 16);
  const times = useMemo(() => {
    // Keep an older start that isn't on the quarter hour, so editing doesn't silently change it.
    const list = time && !QUARTER_HOURS.includes(time) ? [...QUARTER_HOURS, time].sort() : QUARTER_HOURS;
    return list.map((t) => ({ value: t, label: clockLabel(t), past: day === today && t < nowTime && t !== time }));
  }, [day, today, nowTime, time]);

  const submit = form.handle(async () => {
    const fields: Record<string, string> = {};
    if (!day) fields.day = "Choose a day.";
    else if (day < today && !startLocked) fields.day = "Choose today or a later day.";
    if (!time) fields.time = "Choose a start time.";
    else if (day === today && time < nowTime && !startLocked && time !== initialWall.slice(11, 16)) fields.time = "Choose a time from now on.";
    const startAt = day && time ? fromZonedInput(`${day}T${time}`, timeZone) : null;
    if (Object.keys(fields).length || !startAt) {
      form.setFields(fields);
      return;
    }
    await onSubmit({ name, description: description.trim() || null, startAt });
  });

  // The API reports start problems against startAt; show them under the time.
  const timeError = form.fields.time ?? form.fields.startAt;

  return (
    <form onSubmit={submit} noValidate className="details-form">
      <Alert>{form.error}</Alert>
      <TextField label="Event name" value={name} onChange={setName} error={form.fields.name} placeholder="e.g. Wednesday Service" required />
      <div className="field">
        <label htmlFor="event-description">Description (optional)</label>
        <textarea id="event-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        {form.fields.description && <p className="field-error">{form.fields.description}</p>}
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="event-day">Day</label>
          <input
            id="event-day"
            type="date"
            className="date-input"
            value={day}
            min={startLocked ? undefined : today}
            disabled={startLocked}
            required
            aria-invalid={form.fields.day ? true : undefined}
            onChange={(e) => {
              setDay(e.target.value);
              // A time that's now in the past for today is cleared rather than kept.
              if (e.target.value === today && time && time < nowTime) setTime("");
            }}
            // Open the calendar straight away, not only from the small icon.
            onClick={(e) => {
              try {
                e.currentTarget.showPicker();
              } catch {
                /* not supported: the field still works by typing */
              }
            }}
          />
          {form.fields.day && <p className="field-error">{form.fields.day}</p>}
        </div>
        <div className="field">
          <label htmlFor="event-time">Start time</label>
          <select id="event-time" value={time} onChange={(e) => setTime(e.target.value)} disabled={startLocked} required aria-invalid={timeError ? true : undefined}>
            <option value="" disabled>
              Choose…
            </option>
            {times.map((t) => (
              <option key={t.value} value={t.value} disabled={t.past}>
                {t.label}
              </option>
            ))}
          </select>
          {timeError && <p className="field-error">{timeError}</p>}
        </div>
      </div>
      {startLocked && <p className="field-hint">The event has started, so its start can't change.</p>}
      <p className="zone-line">
        <Icon name="clock" size={14} />
        <span>
          Times are in <strong>{zoneLongName(timeZone)}</strong> ({timeZone.replace(/_/g, " ")}). The event ends when its agenda does.
          {canChangeZone && !initial && (
            <>
              {" "}
              <Link className="text-link" to="/admin/settings">
                Change the time zone in Settings
              </Link>
            </>
          )}
        </span>
      </p>
      <div className="button-row">
        <SubmitButton busy={form.busy}>{submitLabel}</SubmitButton>
        {onCancel && (
          <button type="button" className="button button-secondary button-auto" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

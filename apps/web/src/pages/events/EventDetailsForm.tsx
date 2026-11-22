import { useMemo, useState } from "react";
import { Alert, SubmitButton, TextField } from "../../components/Form";
import { useForm } from "../../useForm";
import { allTimeZones, browserTimeZone, fromZonedInput, toZonedInput } from "../../time";

export interface EventDetailsValues {
  name: string;
  description: string | null;
  startAt: string;
  endAt: string;
  timezone: string;
}

/** Name, description, start/end (in the event's time zone) and time zone. Used to create and to edit. */
export function EventDetailsForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: EventDetailsValues;
  submitLabel: string;
  onSubmit: (values: EventDetailsValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [timezone, setTimezone] = useState(initial?.timezone ?? browserTimeZone());
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [start, setStart] = useState(initial ? toZonedInput(initial.startAt, initial.timezone) : "");
  const [end, setEnd] = useState(initial ? toZonedInput(initial.endAt, initial.timezone) : "");
  const form = useForm();
  const zones = useMemo(allTimeZones, []);

  const submit = form.handle(async () => {
    const fields: Record<string, string> = {};
    const startAt = start ? fromZonedInput(start, timezone) : null;
    const endAt = end ? fromZonedInput(end, timezone) : null;
    if (!startAt) fields.startAt = "Choose when the event starts.";
    if (!endAt) fields.endAt = "Choose when the event ends.";
    if (startAt && endAt && Date.parse(endAt) <= Date.parse(startAt)) fields.endAt = "The end must be after the start.";
    if (Object.keys(fields).length) {
      form.setFields(fields);
      return;
    }
    await onSubmit({ name, description: description.trim() || null, startAt: startAt!, endAt: endAt!, timezone });
  });

  return (
    <form onSubmit={submit} noValidate className="details-form">
      <Alert>{form.error}</Alert>
      <TextField label="Event name" value={name} onChange={setName} error={form.fields.name} placeholder="e.g. Annual General Meeting" required />
      <div className="field">
        <label htmlFor="event-description">Description (optional)</label>
        <textarea id="event-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        {form.fields.description && <p className="field-error">{form.fields.description}</p>}
      </div>
      <div className="field-row">
        <TextField label="Starts" type="datetime-local" value={start} onChange={setStart} error={form.fields.startAt} required />
        <TextField label="Ends" type="datetime-local" value={end} onChange={setEnd} error={form.fields.endAt} required />
      </div>
      <div className="field">
        <label htmlFor="event-timezone">Time zone</label>
        <select id="event-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <p className="field-hint">Times are shown to everyone in this time zone.</p>
        {form.fields.timezone && <p className="field-error">{form.fields.timezone}</p>}
      </div>
      <div className="button-row">
        <SubmitButton busy={form.busy}>{submitLabel}</SubmitButton>
        {onCancel && (
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

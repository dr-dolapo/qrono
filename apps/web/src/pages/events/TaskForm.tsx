import { useState } from "react";
import type { EventDetail, Task } from "../../api";
import { Alert, SubmitButton, TextField } from "../../components/Form";
import { useForm } from "../../useForm";

export interface TaskValues {
  title: string;
  durationMinutes: string;
  assigneeIds: string[];
}

/** Add or edit one agenda task. Assignees keep the order they're ticked in (roll-call order). */
export function TaskForm({
  detail,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  resetOnSubmit = false,
}: {
  detail: EventDetail;
  initial?: Task;
  submitLabel: string;
  onSubmit: (values: TaskValues) => Promise<void>;
  onCancel?: () => void;
  resetOnSubmit?: boolean;
}) {
  const { participants } = detail;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [duration, setDuration] = useState(initial ? String(initial.durationMinutes) : "");
  const [assigneeIds, setAssigneeIds] = useState<string[]>(initial?.assigneeIds ?? []);
  const form = useForm();

  const toggle = (id: string) => setAssigneeIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = form.handle(async () => {
    const minutes = Number(duration);
    if (!duration || !Number.isInteger(minutes) || minutes < 1) {
      form.setFields({ durationMinutes: "Enter the length in whole minutes." });
      return;
    }
    await onSubmit({ title, durationMinutes: duration, assigneeIds });
    if (resetOnSubmit) {
      setTitle("");
      setDuration("");
      setAssigneeIds([]);
    }
  });

  return (
    <form onSubmit={submit} noValidate className="task-form">
      <Alert>{form.error}</Alert>
      <div className="task-form-grid">
        <TextField label="Title" value={title} onChange={setTitle} error={form.fields.title} placeholder="e.g. Keynote" required />
        <TextField
          label="Minutes"
          type="number"
          inputMode="numeric"
          min={1}
          max={1440}
          value={duration}
          onChange={setDuration}
          error={form.fields.durationMinutes}
          required
        />
      </div>

      <fieldset className="assignee-picker">
        <legend>Who runs it</legend>
        {participants.length === 0 ? (
          <p className="muted small">Add people to the event (below) to assign them.</p>
        ) : (
          <div className="chips">
            {participants.map((p) => {
              const position = assigneeIds.indexOf(p.id);
              return (
                <label key={p.id} className={`chip ${position >= 0 ? "chip-on" : ""}`}>
                  <input type="checkbox" checked={position >= 0} onChange={() => toggle(p.id)} />
                  {position >= 0 && <span className="chip-number">{position + 1}</span>}
                  {p.name}
                  {p.kind === "guest" && <span className="muted"> · guest</span>}
                </label>
              );
            })}
          </div>
        )}
        {assigneeIds.length > 1 && <p className="muted small">Numbers show the roll-call order.</p>}
        {form.fields.assigneeIds && <p className="field-error">{form.fields.assigneeIds}</p>}
      </fieldset>

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

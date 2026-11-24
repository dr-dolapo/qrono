import { useState, type FormEvent } from "react";
import { ApiError, type Task } from "../../../api";
import { DurationSelect } from "./DurationSelect";
import { WhatField } from "./WhatField";
import { WhoPicker, type PickerPerson, type WhoRef } from "./WhoPicker";
import clsx from "clsx";

export interface AgendaItemValues {
  title: string;
  durationMinutes: number;
  who: WhoRef[];
}

/**
 * Add or edit one agenda item: What, Duration and Who, all required. The tick turns
 * green and becomes usable once all three are filled in.
 */
export function AgendaItemEditor({
  teamId,
  people,
  initial,
  initialWho = [],
  needEmailForNew,
  onCreatePerson,
  onSave,
  onCancel,
  onDelete,
  autoFocus = true,
}: {
  teamId: string;
  people: PickerPerson[];
  initial?: Task;
  initialWho?: PickerPerson[];
  needEmailForNew: boolean;
  onCreatePerson: (name: string, email: string | null) => Promise<PickerPerson>;
  onSave: (values: AgendaItemValues) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
  autoFocus?: boolean;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [duration, setDuration] = useState<number | null>(initial?.durationMinutes ?? null);
  const [who, setWho] = useState<PickerPerson[]>(initialWho);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const complete = title.trim().length > 0 && duration !== null && who.length > 0;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!complete || busy) return;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await onSave({ title: title.trim(), durationMinutes: duration!, who: who.map((p) => p.ref) });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFields(err.fields);
      } else setError("Couldn't save this item. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="agenda-editor" onSubmit={submit} noValidate aria-label={initial ? `Edit ${initial.title}` : "New agenda item"}>
      <button type="button" className="agenda-cancel" aria-label="Cancel" onClick={onCancel}>
        ×
      </button>
      <div className="agenda-editor-grid">
        <div className="agenda-field agenda-what">
          <span className="agenda-label" aria-hidden="true">What</span>
          <WhatField teamId={teamId} value={title} onChange={setTitle} invalid={!!fields.title} autoFocus={autoFocus} />
        </div>
        <div className="agenda-field agenda-duration">
          <span className="agenda-label" aria-hidden="true">Duration</span>
          <DurationSelect value={duration} onChange={setDuration} invalid={!!fields.durationMinutes} />
        </div>
        <div className="agenda-field agenda-who">
          <span className="agenda-label" aria-hidden="true">Who</span>
          <WhoPicker people={people} value={who} onChange={setWho} onCreate={onCreatePerson} needEmailForNew={needEmailForNew} invalid={!!fields.who} />
        </div>
        <button
          type="submit"
          className={clsx("agenda-save", complete && "is-ready")}
          aria-label={complete ? "Save item" : "Save item (fill in What, Duration and Who first)"}
          aria-disabled={!complete || busy}
        >
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {(error || onDelete) && (
        <div className="agenda-editor-foot">
          {error ? (
            <p className="field-error" role="alert">
              {Object.values(fields)[0] ?? error}
            </p>
          ) : (
            <span />
          )}
          {onDelete && (
            <button type="button" className="link-button danger-link" disabled={busy} onClick={() => onDelete().catch(() => setError("Couldn't delete this item."))}>
              Delete item
            </button>
          )}
        </div>
      )}
    </form>
  );
}

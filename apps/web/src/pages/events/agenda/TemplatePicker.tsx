import { useEffect, useState } from "react";
import { ApiError, api, type Template } from "../../../api";
import { durationLabel, formatLongDate } from "../../../time";

/** Start an empty agenda from one of the team's previous programs (copies What and Duration). */
export function TemplatePicker({ teamId, eventId, onUse, onClose }: { teamId: string; eventId: string; onUse: (sourceEventId: string) => Promise<void>; onClose: () => void }) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ templates: Template[] }>(`/teams/${teamId}/templates?exclude=${encodeURIComponent(eventId)}`)
      .then((r) => setTemplates(r.templates))
      .catch(() => setError("Couldn't load your previous programs."));
  }, [teamId, eventId]);

  async function use(id: string) {
    setBusy(id);
    setError(null);
    try {
      await onUse(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't copy that program.");
      setBusy(null);
    }
  }

  return (
    <section className="template-picker" aria-labelledby="template-heading">
      <div className="template-head">
        <h3 id="template-heading">Start from a previous program</h3>
        <button type="button" className="link-button muted-link" onClick={onClose}>
          Cancel
        </button>
      </div>
      <p className="muted small">Copies each item's What and Duration. You choose Who for this program.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      {templates === null && !error && <p className="muted small">Loading…</p>}
      {templates?.length === 0 && <p className="muted small">No approved programs yet. Once one is approved, you can reuse it here.</p>}
      {templates && templates.length > 0 && (
        <ul className="template-list">
          {templates.map((t) => (
            <li key={t.eventId}>
              <button type="button" className="template-option" disabled={busy !== null} onClick={() => use(t.eventId)}>
                <strong>{t.name}</strong>
                <span className="muted small">
                  {formatLongDate(t.startAt, t.timezone)} · {t.items} item{t.items === 1 ? "" : "s"} · {durationLabel(t.minutes)}
                </span>
                {busy === t.eventId && <span className="small">Copying…</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

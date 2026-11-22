import { useState } from "react";
import { ApiError, type EventDetail } from "../../api";
import { Alert, TextField } from "../../components/Form";
import { useForm } from "../../useForm";
import type { Mutate } from "./EventEditor";

/** Stages (halls). Not needed for a single-stage event. */
export function StagesSection({ detail, mutate }: { detail: EventDetail; mutate: Mutate }) {
  const { stages, tasks, permissions } = detail;
  const [name, setName] = useState("");
  const [venue, setVenue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const form = useForm();

  if (!permissions.canEdit && stages.length === 0) return null;

  const add = form.handle(async () => {
    await mutate("/stages", "POST", { name, venue: venue || null });
    setName("");
    setVenue("");
  });

  return (
    <section className="section" aria-labelledby="stages-heading">
      <h2 id="stages-heading">
        Stages <span className="count">{stages.length}</span>
      </h2>
      <p className="muted small">
        {stages.length === 0
          ? "Only one stage? You don't need to add any. Add stages (usually named after the hall) for breakouts or parallel programs."
          : "Each task runs on one stage, or on all stages at once."}
      </p>
      <Alert>{error}</Alert>

      {stages.length > 0 && (
        <ul className="rows">
          {stages.map((s) => {
            const count = tasks.filter((t) => t.stageId === s.id).length;
            return (
              <li key={s.id} className="row">
                <div className="row-main">
                  <strong>{s.name}</strong>
                  <span className="muted small">
                    {s.venue ? `${s.venue} · ` : ""}
                    {count} task{count === 1 ? "" : "s"}
                  </span>
                </div>
                {permissions.canEdit && (
                  <div className="row-actions">
                    <button
                      type="button"
                      className="button button-small"
                      onClick={async () => {
                        setError(null);
                        try {
                          await mutate(`/stages/${s.id}`, "DELETE");
                        } catch (err) {
                          setError(err instanceof ApiError ? err.message : "Couldn't remove that stage.");
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {permissions.canEdit && (
        <form onSubmit={add} noValidate className="card-panel">
          <Alert>{form.error}</Alert>
          <div className="field-row">
            <TextField label="Stage name" value={name} onChange={setName} error={form.fields.name} placeholder="e.g. Adire Hall" />
            <TextField label="Venue (optional)" value={venue} onChange={setVenue} placeholder="e.g. Radisson Blu" />
          </div>
          <button type="submit" className="button button-small" disabled={form.busy}>
            Add stage
          </button>
        </form>
      )}
    </section>
  );
}

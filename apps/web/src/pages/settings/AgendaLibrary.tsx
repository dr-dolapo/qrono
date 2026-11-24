import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../api";
import { formatDayMonth } from "../../time";

interface Library {
  suggestions: { title: string; uses: number; hidden: boolean }[];
  templates: { eventId: string; name: string; startAt: string; timezone: string; items: number; pinned: boolean }[];
}

/** Hide "What" suggestions the team no longer wants, and pin favourite programs to the top of the templates. */
export function AgendaLibrary({ teamId }: { teamId: string }) {
  const [lib, setLib] = useState<Library | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    api<Library>(`/teams/${teamId}/library`)
      .then(setLib)
      .catch(() => toast.error("Couldn't load the agenda library."));
  }, [teamId]);

  if (!lib) return <p className="muted">Loading…</p>;
  if (lib.suggestions.length === 0) return <p>Nothing yet. Items from approved programs appear here.</p>;

  const shown = showAll ? lib.suggestions : lib.suggestions.slice(0, 12);

  async function setHidden(title: string, hidden: boolean) {
    await api(`/teams/${teamId}/library/suggestions`, { method: "PUT", body: { title, hidden } });
    setLib((l) => l && { ...l, suggestions: l.suggestions.map((x) => (x.title === title ? { ...x, hidden } : x)) });
    toast.success(hidden ? `“${title}” won't be suggested` : `“${title}” is suggested again`);
  }
  async function setPinned(eventId: string, pinned: boolean) {
    await api(`/teams/${teamId}/library/templates`, { method: "PUT", body: { eventId, pinned } });
    setLib((l) => l && { ...l, templates: l.templates.map((x) => (x.eventId === eventId ? { ...x, pinned } : x)).sort((a, b) => Number(b.pinned) - Number(a.pinned)) });
  }

  return (
    <div className="library">
      <h3 className="sub-head">Suggestions for What</h3>
      <ul className="list list-ruled">
        {shown.map((x) => (
          <li key={x.title} className="list-row compact-row">
            <span className="list-main">
              <span className={x.hidden ? "list-name is-struck" : "list-name"}>{x.title}</span>
              <span className="list-sub">
                Used {x.uses} time{x.uses === 1 ? "" : "s"}
                {x.hidden && " · not suggested"}
              </span>
            </span>
            <button type="button" className="button button-secondary button-small" onClick={() => setHidden(x.title, !x.hidden)}>
              {x.hidden ? "Suggest again" : "Stop suggesting"}
            </button>
          </li>
        ))}
      </ul>
      {lib.suggestions.length > 12 && (
        <button type="button" className="text-link library-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${lib.suggestions.length}`}
        </button>
      )}

      <h3 className="sub-head">Templates</h3>
      <ul className="list list-ruled">
        {lib.templates.slice(0, showAll ? undefined : 8).map((t) => (
          <li key={t.eventId} className="list-row compact-row">
            <span className="list-main">
              <span className="list-name">{t.name}</span>
              <span className="list-sub">
                {formatDayMonth(t.startAt, t.timezone)} · {t.items} item{t.items === 1 ? "" : "s"}
                {t.pinned && " · pinned to the top"}
              </span>
            </span>
            <button type="button" className="button button-secondary button-small" aria-pressed={t.pinned} onClick={() => setPinned(t.eventId, !t.pinned)}>
              {t.pinned ? "Unpin" : "Pin"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

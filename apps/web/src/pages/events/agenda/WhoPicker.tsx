import { useId, useMemo, useRef, useState } from "react";
import { ApiError, PERSON_STATUS_LABEL, type Person } from "../../../api";

/** What the API's `who` accepts for one person. */
export type WhoRef = { userId: string } | { contactId: string } | { participantId: string };

/** Someone who can be picked for "Who". */
export interface PickerPerson {
  key: string;
  name: string;
  email: string | null;
  ref: WhoRef;
  /** From the team's people list; "guest" for an older guest only on this event. */
  status: Person["status"] | "guest";
}

export function StatusTag({ person }: { person: Pick<PickerPerson, "status" | "email"> }) {
  if (person.status === "guest") return <span className="person-tag tag-muted">Guest</span>;
  return (
    <>
      <span className={`person-tag tag-${person.status}`}>{PERSON_STATUS_LABEL[person.status]}</span>
      {person.status !== "member" && !person.email && <span className="person-tag tag-warn">No email</span>}
    </>
  );
}

/**
 * "Who": one or more people from the team's running list (members, and people
 * invited or still to be invited). Typing a new name adds them to the list. On an
 * approved program their email is asked for straight away, since they're invited at once.
 */
export function WhoPicker({
  people,
  value,
  onChange,
  onCreate,
  needEmailForNew,
  invalid,
}: {
  people: PickerPerson[];
  value: PickerPerson[];
  onChange: (people: PickerPerson[]) => void;
  onCreate: (name: string, email: string | null) => Promise<PickerPerson>;
  needEmailForNew: boolean;
  invalid?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [newEmail, setNewEmail] = useState<string | null>(null); // asking for a new person's email
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = new Set(value.map((p) => p.key));
  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => people.filter((p) => !chosen.has(p.key) && (!q || p.name.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q))).slice(0, 8),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [people, q, value],
  );
  const canAddNew = q.length > 0 && !people.some((p) => p.name.toLowerCase() === q);
  const options = [...matches.map((p) => ({ type: "person" as const, person: p })), ...(canAddNew ? [{ type: "new" as const }] : [])];

  const pick = (p: PickerPerson) => {
    onChange([...value, p]);
    setQuery("");
    setActive(0);
    // Close the list so the tick is reachable; typing or clicking reopens it for another person.
    setOpen(false);
    inputRef.current?.focus();
  };

  async function create(email: string | null) {
    setBusy(true);
    setError(null);
    try {
      pick(await onCreate(query.trim(), email));
      setNewEmail(null);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.email ?? err.fields.name ?? err.message) : "Couldn't add that person.");
    } finally {
      setBusy(false);
    }
  }

  const chooseOption = (i: number) => {
    const option = options[i];
    if (!option) return;
    if (option.type === "person") pick(option.person);
    else if (needEmailForNew) setNewEmail("");
    else void create(null);
  };

  return (
    <div className="combo">
      <div className={`who-box ${invalid ? "is-invalid" : ""}`} onClick={() => inputRef.current?.focus()}>
        {value.map((p, i) => (
          <span key={p.key} className="who-chip">
            {value.length > 1 && <span className="chip-number">{i + 1}</span>}
            {p.name}
            <button
              type="button"
              className="who-chip-remove"
              aria-label={`Remove ${p.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((x) => x.key !== p.key));
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="who-input"
          value={query}
          placeholder={value.length ? "" : "Name"}
          autoComplete="off"
          role="combobox"
          aria-label="Who"
          aria-autocomplete="list"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-activedescendant={open && options.length ? `${listId}-${active}` : undefined}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
            setNewEmail(null);
            setError(null);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => newEmail === null && setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !query && value.length) onChange(value.slice(0, -1));
            if (!open || options.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (i + 1) % options.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
            } else if (e.key === "Enter" && q) {
              e.preventDefault();
              chooseOption(active);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </div>

      {open && (options.length > 0 || newEmail !== null) && (
        <div className="combo-list who-list" onMouseDown={(e) => e.target instanceof HTMLInputElement || e.preventDefault()}>
          <ul id={listId} role="listbox" aria-label="People">
            {options.map((o, i) => (
              <li
                key={o.type === "person" ? o.person.key : "new"}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`combo-option ${i === active ? "is-active" : ""}`}
                onClick={() => chooseOption(i)}
              >
                {o.type === "person" ? (
                  <>
                    <span className="option-name">{o.person.name}</span>
                    <StatusTag person={o.person} />
                  </>
                ) : (
                  <span className="option-new">
                    Add “{query.trim()}” as a new person
                  </span>
                )}
              </li>
            ))}
          </ul>
          {newEmail !== null && (
            <div className="who-new">
              <label className="small" htmlFor={`${id}-email`}>
                {query.trim()}'s email. This program is approved, so they're invited straight away.
              </label>
              <div className="who-new-row">
                <input
                  id={`${id}-email`}
                  type="email"
                  inputMode="email"
                  className="agenda-input"
                  value={newEmail}
                  autoFocus
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void create(newEmail.trim());
                    }
                  }}
                />
                <button type="button" className="button button-small" disabled={busy || !newEmail.trim()} onClick={() => create(newEmail.trim())}>
                  Add
                </button>
              </div>
            </div>
          )}
          {error && <p className="field-error who-error">{error}</p>}
        </div>
      )}
    </div>
  );
}

import { Combobox } from "@base-ui/react/combobox";
import clsx from "clsx";
import { useId, useMemo, useState } from "react";
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
      <span className={clsx("person-tag", `tag-${person.status}`)}>{PERSON_STATUS_LABEL[person.status]}</span>
      {person.status !== "member" && !person.email && <span className="person-tag tag-warn">No email</span>}
    </>
  );
}

/** The "Add “Name” as a new person" row, kept in the list alongside real people. */
type Option = PickerPerson | { key: "__new"; name: string };
const isNew = (o: Option): o is { key: "__new"; name: string } => o.key === "__new";

/**
 * "Who": one or more people from the team's running list (members, and people
 * invited or still to be invited). Typing a new name adds them to the list. On an
 * approved program their email is asked for straight away, since they're invited at once.
 * base-ui's Combobox handles the keyboard, focus and screen-reader wiring.
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
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pendingName, setPendingName] = useState<string | null>(null); // new person waiting for an email
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const options = useMemo<Option[]>(() => {
    const chosen = new Set(value.map((p) => p.key));
    const matches = people
      .filter((p) => !chosen.has(p.key) && (!q || p.name.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q)))
      .slice(0, 8);
    const canAddNew = q.length > 0 && !people.some((p) => p.name.toLowerCase() === q);
    return canAddNew ? [...matches, { key: "__new", name: query.trim() }] : matches;
  }, [people, value, q, query]);

  async function create(name: string, email: string | null) {
    setBusy(true);
    setError(null);
    try {
      const person = await onCreate(name, email);
      onChange([...value, person]);
      setPendingName(null);
      setNewEmail("");
      setQuery("");
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.email ?? err.fields.name ?? err.message) : "Couldn't add that person.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="combo">
      <Combobox.Root<Option, true>
        multiple
        items={options}
        filter={null}
        autoHighlight
        value={value}
        inputValue={query}
        open={open && options.length > 0}
        onOpenChange={(next) => setOpen(next)}
        onInputValueChange={(next, details) => {
          // base-ui clears the input after a pick; keep typing behaviour otherwise.
          setQuery(details.reason === "item-press" ? "" : next);
          setError(null);
          if (details.reason === "input-change") setPendingName(null);
        }}
        itemToStringLabel={(o) => o.name}
        isItemEqualToValue={(a, b) => a.key === b.key}
        onValueChange={(next, details) => {
          const added = next.find(isNew);
          if (added) {
            setOpen(false);
            if (needEmailForNew) {
              setPendingName(added.name);
              setNewEmail("");
            } else {
              void create(added.name, null);
            }
            return;
          }
          onChange(next.filter((o): o is PickerPerson => !isNew(o)));
          setQuery("");
          // Close after a pick so the tick is reachable; typing reopens it for another person.
          if (details.reason === "item-press") setOpen(false);
        }}
      >
        <Combobox.Chips className={clsx("who-box", invalid && "is-invalid")}>
          {value.map((p, i) => (
            <Combobox.Chip key={p.key} className="who-chip" aria-label={p.name}>
              {value.length > 1 && <span className="chip-number">{i + 1}</span>}
              {p.name}
              <Combobox.ChipRemove className="who-chip-remove" aria-label={`Remove ${p.name}`}>
                ×
              </Combobox.ChipRemove>
            </Combobox.Chip>
          ))}
          <Combobox.Input className="who-input" aria-label="Who" placeholder={value.length ? "" : "Name"} aria-invalid={invalid || undefined} />
        </Combobox.Chips>

        <Combobox.Portal>
          <Combobox.Positioner className="combo-positioner" sideOffset={6} align="start">
            <Combobox.Popup className="combo-list who-list" aria-label="People">
              <Combobox.List>
                {(o: Option) => (
                  <Combobox.Item key={o.key} value={o} className="combo-option">
                    {isNew(o) ? (
                      <span className="option-new">Add “{o.name}” as a new person</span>
                    ) : (
                      <>
                        <span className="option-name">{o.name}</span>
                        <StatusTag person={o} />
                      </>
                    )}
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>

      {pendingName !== null && (
        <div className="who-new">
          <label className="small" htmlFor={`${id}-email`}>
            {pendingName}'s email. This program is approved, so they're invited straight away.
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
                  void create(pendingName, newEmail.trim());
                }
                if (e.key === "Escape") setPendingName(null);
              }}
            />
            <button type="button" className="button button-small" disabled={busy || !newEmail.trim()} onClick={() => create(pendingName, newEmail.trim())}>
              Add
            </button>
          </div>
        </div>
      )}
      {error && <p className="field-error who-error">{error}</p>}
    </div>
  );
}

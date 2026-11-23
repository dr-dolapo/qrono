import { useEffect, useId, useRef, useState } from "react";
import { api } from "../../../api";

/**
 * "What": free text, with suggestions from this team's previously approved agenda
 * items as you type (the API only ever looks at the event's own team).
 */
export function WhatField({
  teamId,
  value,
  onChange,
  invalid,
  autoFocus,
}: {
  teamId: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = useRef(false);

  useEffect(() => {
    const q = value.trim();
    if (!typed.current || !q) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api<{ suggestions: string[] }>(`/teams/${teamId}/agenda-suggestions?q=${encodeURIComponent(q)}`)
        .then((r) => {
          if (cancelled) return;
          // Nothing to suggest if the only match is exactly what's typed.
          const list = r.suggestions.filter((s) => s.toLowerCase() !== q.toLowerCase());
          setSuggestions(list);
          setActive(-1);
          setOpen(list.length > 0);
        })
        .catch(() => setSuggestions([]));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [teamId, value]);

  const choose = (s: string) => {
    typed.current = false;
    onChange(s);
    setOpen(false);
    setSuggestions([]);
  };

  return (
    <div className="combo">
      <input
        id={id}
        className="agenda-input"
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        maxLength={120}
        role="combobox"
        aria-label="What"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          typed.current = true;
          onChange(e.target.value);
        }}
        onBlur={() => setOpen(false)}
        onFocus={() => suggestions.length && setOpen(true)}
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % suggestions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            choose(suggestions[active]!);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul id={listId} role="listbox" className="combo-list" aria-label="Earlier agenda items">
          {suggestions.map((s, i) => (
            <li
              key={s}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`combo-option ${i === active ? "is-active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(s)}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

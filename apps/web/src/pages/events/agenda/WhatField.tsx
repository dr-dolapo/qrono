import { Autocomplete } from "@base-ui/react/autocomplete";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../api";

/**
 * "What": free text, with suggestions from this team's previously approved agenda
 * items as you type (the API only ever looks at the event's own team).
 * base-ui handles the keyboard, focus and screen-reader wiring.
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
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  // Only look things up after the person types, not when an existing item is opened for editing.
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
          setOpen(list.length > 0);
        })
        .catch(() => setSuggestions([]));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [teamId, value]);

  return (
    <Autocomplete.Root
      items={suggestions}
      filter={null}
      value={value}
      open={open && suggestions.length > 0}
      onOpenChange={(next) => setOpen(next)}
      onValueChange={(next, details) => {
        typed.current = details.reason === "input-change";
        if (!typed.current) setSuggestions([]);
        onChange(next);
      }}
    >
      <div className="combo">
        <Autocomplete.Input
          className="agenda-input"
          aria-label="What"
          aria-invalid={invalid || undefined}
          autoFocus={autoFocus}
          maxLength={120}
        />
      </div>
      <Autocomplete.Portal>
        <Autocomplete.Positioner className="combo-positioner" sideOffset={6} align="start">
          <Autocomplete.Popup className="combo-list" aria-label="Earlier agenda items">
            <Autocomplete.List>
              {(item: string) => (
                <Autocomplete.Item key={item} value={item} className="combo-option">
                  {item}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}

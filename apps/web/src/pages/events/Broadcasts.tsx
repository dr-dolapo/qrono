import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type EventDetail } from "../../api";
import { Alert } from "../../components/Form";
import { toast } from "sonner";
import clsx from "clsx";

type Reply = "none" | "acknowledged" | "snoozed" | "done";

interface MyBroadcast {
  id: string;
  body: string;
  sentBy: string;
  sentAt: string;
  response: Reply;
  snoozeUntil: string | null;
}

interface SentBroadcast {
  id: string;
  body: string;
  audience: "everyone" | "participants";
  sentBy: string;
  sentAt: string;
  receipts: { userId: string; name: string; response: Reply; respondedAt: string | null; snoozeUntil: string | null; snoozeCount: number }[];
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** Reload signal: bump to refetch after a live message. */
export function useBroadcastSignal() {
  const [version, setVersion] = useState(0);
  return { version, bump: useCallback(() => setVersion((v) => v + 1), []) };
}

/**
 * QR040 / QR041: broadcasts for the signed-in participant. New ones arrive
 * over the live connection; a snoozed one comes back after 3 minutes.
 */
export function BroadcastAlerts({ eventId, version }: { eventId: string; version: number }) {
  const [items, setItems] = useState<MyBroadcast[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api<{ broadcasts: MyBroadcast[] }>(`/events/${eventId}/broadcasts`)
      .then((r) => setItems(r.broadcasts))
      .catch(() => setError("Couldn't load messages."));
  }, [eventId, version]);

  const waiting = items.filter((b) => b.response === "none");
  const snoozed = items.filter((b) => b.response === "snoozed");

  // Get attention for a new alert: vibrate on phones and mark the tab title.
  useEffect(() => {
    if (waiting.length === 0) return;
    navigator.vibrate?.([200, 100, 200]);
    const original = document.title;
    document.title = `(${waiting.length}) New message · Qrono`;
    return () => {
      document.title = original;
    };
  }, [waiting.length]);

  async function reply(id: string, response: Exclude<Reply, "none">) {
    setBusy(id);
    setError(null);
    try {
      const res = await api<{ response: Reply; snoozeUntil: string | null }>(`/events/${eventId}/broadcasts/${id}/respond`, { body: { response } });
      setItems((list) => list.map((b) => (b.id === id ? { ...b, response: res.response, snoozeUntil: res.snoozeUntil } : b)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send your reply.");
    } finally {
      setBusy(null);
    }
  }

  if (waiting.length === 0 && snoozed.length === 0) return error ? <Alert>{error}</Alert> : null;

  return (
    <section className="broadcast-alerts" aria-live="assertive" aria-label="Messages from the event team">
      <Alert>{error}</Alert>
      {waiting.map((b) => (
        <div key={b.id} className="broadcast-alert" role="alert">
          <div className="broadcast-meta">
            <span className="live-label">🔔 Message from {b.sentBy}</span>
            <span className="muted small">{time(b.sentAt)}</span>
          </div>
          <p className="broadcast-body">{b.body}</p>
          <div className="button-row">
            <button type="button" className="button button-small button-primary" disabled={busy === b.id} onClick={() => reply(b.id, "acknowledged")}>
              Acknowledge
            </button>
            <button type="button" className="button button-small" disabled={busy === b.id} onClick={() => reply(b.id, "snoozed")}>
              Snooze 3 min
            </button>
            <button type="button" className="button button-small" disabled={busy === b.id} onClick={() => reply(b.id, "done")}>
              Done
            </button>
          </div>
        </div>
      ))}
      {snoozed.map((b) => (
        <p key={b.id} className="muted small broadcast-snoozed">
          Snoozed: “{b.body}” — back at {b.snoozeUntil ? time(b.snoozeUntil) : "soon"}.
        </p>
      ))}
    </section>
  );
}

const REPLY_LABEL: Record<Reply, string> = { none: "No reply yet", acknowledged: "Acknowledged", snoozed: "Snoozed", done: "Done" };

/** QR038 / QR039 / QR042: Approvers and Admins send broadcasts and watch the replies. */
export function BroadcastPanel({ detail, version }: { detail: EventDetail; version: number }) {
  const eventId = detail.event.id;
  const [sent, setSent] = useState<SentBroadcast[]>([]);
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"everyone" | "participants">("everyone");
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api<{ broadcasts: SentBroadcast[] }>(`/events/${eventId}/broadcasts`)
      .then((r) => setSent(r.broadcasts))
      .catch(() => setError("Couldn't load broadcasts."));
  }, [eventId, version]);

  // Guests don't receive broadcasts, so only registered people can be chosen.
  const people = detail.participants.filter((p) => p.kind === "member" && p.userId !== detail.me.userId);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ broadcast: { id: string; recipients: number } }>(`/events/${eventId}/broadcasts`, {
        body: audience === "everyone" ? { body, audience } : { body, audience, participantIds: chosen },
      });
      toast.success(`Broadcast sent to ${res.broadcast.recipients} ${res.broadcast.recipients === 1 ? "person" : "people"}`);
      setBody("");
      setChosen([]);
      const r = await api<{ broadcasts: SentBroadcast[] }>(`/events/${eventId}/broadcasts`);
      setSent(r.broadcasts);
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fields)[0] ?? err.message) : "Couldn't send the broadcast.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section" aria-labelledby="broadcast-heading">
      <h2 id="broadcast-heading">Broadcasts</h2>
      <p className="muted small">Send a quick message to people's screens. They can acknowledge, snooze for 3 minutes, or mark it done. Guests don't receive broadcasts.</p>

      <div className="card-panel broadcast-composer">
        <Alert>{error}</Alert>
        <div className="field">
          <label htmlFor="broadcast-body">Message</label>
          <textarea id="broadcast-body" rows={2} maxLength={280} value={body} onChange={(e) => setBody(e.target.value)} placeholder="e.g. Keynote speaker to the stage in 5 minutes" />
          <p className="field-hint">{280 - body.length} characters left</p>
        </div>
        <fieldset className="assignee-picker">
          <legend>Send to</legend>
          <div className="chips">
            <label className={clsx("chip", audience === "everyone" && "chip-on")}>
              <input type="radio" name="audience" checked={audience === "everyone"} onChange={() => setAudience("everyone")} />
              Everyone on the event
            </label>
            <label className={clsx("chip", audience === "participants" && "chip-on")}>
              <input type="radio" name="audience" checked={audience === "participants"} onChange={() => setAudience("participants")} />
              Choose people
            </label>
          </div>
          {audience === "participants" && (
            <div className="chips chips-sub">
              {people.length === 0 && <p className="muted small">No team members on this event to choose.</p>}
              {people.map((p) => {
                const on = chosen.includes(p.id);
                return (
                  <label key={p.id} className={clsx("chip", on && "chip-on")}>
                    <input type="checkbox" checked={on} onChange={() => setChosen((c) => (on ? c.filter((x) => x !== p.id) : [...c, p.id]))} />
                    {p.name}
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>
        <button
          type="button"
          className="button button-primary button-auto"
          disabled={busy || !body.trim() || (audience === "participants" && chosen.length === 0)}
          onClick={send}
        >
          {busy ? "Sending…" : "Send broadcast"}
        </button>
      </div>

      {sent.length > 0 && (
        <ul className="rows">
          {sent.map((b) => {
            const count = (r: Reply) => b.receipts.filter((x) => x.response === r).length;
            return (
              <li key={b.id} className="row broadcast-row">
                <div className="broadcast-line">
                  <div className="row-main">
                    <strong>{b.body}</strong>
                    <span className="muted small">
                      {time(b.sentAt)} · {b.sentBy} · {b.audience === "everyone" ? "everyone" : `${b.receipts.length} chosen`}
                    </span>
                  </div>
                  <div className="row-actions">
                    <span className="response response-acknowledged">{count("acknowledged") + count("done")} ✓</span>
                    {count("snoozed") > 0 && <span className="response response-pending">{count("snoozed")} snoozed</span>}
                    {count("none") > 0 && <span className="response response-declined">{count("none")} waiting</span>}
                    <button type="button" className="button button-small" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>
                      {open === b.id ? "Hide" : "Who replied"}
                    </button>
                  </div>
                </div>
                {open === b.id && (
                  <ul className="plain-list broadcast-receipts">
                    {b.receipts.map((r) => (
                      <li key={r.userId}>
                        {r.name}: <span className={`response response-${r.response === "none" ? "declined" : r.response === "snoozed" ? "pending" : "acknowledged"}`}>{REPLY_LABEL[r.response]}</span>
                        {r.respondedAt && <span className="muted small"> at {time(r.respondedAt)}</span>}
                        {r.snoozeCount > 0 && <span className="muted small"> · snoozed {r.snoozeCount}×</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { ApiError, api, type GuestProgram } from "../api";
import { Alert } from "../components/Form";
import { formatDate, formatDuration, formatTime } from "../time";
import { Logo } from "../components/Logo";

/**
 * QR044–QR046: the guest's personal page, opened from their emailed link on a
 * phone browser. No account or app. Shows the program, highlights their own
 * tasks, and lets them confirm or decline. The link expires when the event ends.
 */
export function GuestView() {
  const { token = "" } = useParams();
  const [data, setData] = useState<GuestProgram | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<GuestProgram>(`/guest/${encodeURIComponent(token)}`)
      .then(setData)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Couldn't open this page. Check your connection."));
  }, [token]);

  async function respond(response: "acknowledged" | "declined") {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ me: GuestProgram["me"] }>(`/guest/${encodeURIComponent(token)}/response`, {
        body: response === "declined" ? { response, reason } : { response },
      });
      setData((d) => (d ? { ...d, me: res.me } : d));
      setDeclining(false);
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.reason ?? err.message) : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <main className="page guest">
        <p className="brand"><Logo size={24} /></p>
        <Alert>{loadError}</Alert>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="page guest" aria-busy="true">
        <p className="brand"><Logo size={24} /></p>
        <p className="muted">Loading your program…</p>
      </main>
    );
  }

  const { event, me, program, teamName } = data;
  const tz = event.timezone;
  const mine = program.filter((p) => p.mine);

  return (
    <main className="page guest">
      <p className="brand"><Logo size={24} /></p>
      <p className="muted small guest-from">{teamName}</p>
      <h1 className="guest-title">{event.name}</h1>
      <p className="event-when">{formatDate(event.startAt, tz)}</p>
      <p className="muted small">
        {formatTime(event.startAt, tz)} – {formatTime(event.endAt, tz)} · times in {tz.replace(/_/g, " ")}
      </p>

      <section className="card-panel guest-mine" aria-labelledby="guest-mine">
        <h2 id="guest-mine">Hi {me.name}, your part</h2>
        {mine.length ? (
          <ul className="plain-list guest-tasks">
            {mine.map((t) => (
              <li key={t.id}>
                <span className="guest-time">{formatTime(t.startAt, tz)}</span>
                <span>
                  <strong>{t.title}</strong>
                  <span className="muted small"> · {formatDuration(t.durationMinutes)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">You're on the program; your task will appear here.</p>
        )}

        {me.response === "acknowledged" && <Alert kind="success">Thanks, you've confirmed you'll be there.</Alert>}
        {me.response === "declined" && <Alert kind="info">You've told the team you can't take part: “{me.declineReason}”.</Alert>}
        <Alert>{error}</Alert>

        {declining ? (
          <div className="field">
            <label htmlFor="guest-reason">Why can't you take part?</label>
            <textarea id="guest-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            <div className="stack">
              <button type="button" className="button button-danger" disabled={busy} onClick={() => respond("declined")}>
                Send to the team
              </button>
              <button type="button" className="button" onClick={() => setDeclining(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="stack">
            {me.response !== "acknowledged" && (
              <button type="button" className="button button-primary" disabled={busy} onClick={() => respond("acknowledged")}>
                I'll be there
              </button>
            )}
            {me.response !== "declined" && (
              <button type="button" className="button" disabled={busy} onClick={() => setDeclining(true)}>
                I can't make it
              </button>
            )}
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="guest-program">
        <h2 id="guest-program">Full program</h2>
        <ol className="rows">
          {program.map((t) => (
            <li key={t.id} className={`row agenda-row ${t.mine ? "row-mine" : ""}`}>
              <div className="agenda-time">
                <strong>{formatTime(t.startAt, tz)}</strong>
              </div>
              <div className="row-main">
                <strong>{t.title}</strong>
                <span className="muted small">
                  {formatDuration(t.durationMinutes)}
                  {t.mine && " · you"}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <p className="muted small">This page is just for you; please don't share the link. It stops working when the event ends.</p>
    </main>
  );
}

import { useEffect, useState } from "react";
import { CountdownHero } from "../components/CountdownHero";
import { countdown } from "../countdown";
import { useClock } from "../useClock";
import { useParams } from "react-router";
import { ApiError, api, type GuestProgram } from "../api";
import { Alert } from "../components/Form";
import { formatDate, formatDuration, formatTime, setClockFormat } from "../time";
import { Logo } from "../components/Logo";
import clsx from "clsx";

/**
 * QR044–QR046: the guest's personal page, opened from their emailed link on a
 * phone browser. No account or app. The countdown comes first (to the start, or what's on now),
 * then their own part, which they're attending by default but can decline, then the program.
 * The link expires when the event ends.
 */
export function GuestView() {
  const { token = "" } = useParams();
  const [data, setData] = useState<GuestProgram | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [clockOffset, setClockOffset] = useState(0);
  const clock = useClock().getTime();

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (first: boolean) =>
      api<GuestProgram>(`/guest/${encodeURIComponent(token)}`)
        .then((d) => {
          if (stopped) return;
          setData(d);
          if (d.live) setClockOffset(Date.parse(d.live.serverTime) - Date.now());
          // Guests have no live connection: check every 15 seconds while it's on or about to start.
          const soon = Date.parse(d.event.startAt) - Date.now() < 2 * 3_600_000;
          if (d.event.status === "live" || (d.event.status === "approved" && soon)) timer = setTimeout(() => load(false), 15_000);
        })
        .catch((err) => {
          if (first && !stopped) setLoadError(err instanceof ApiError ? err.message : "Couldn't open this page. Check your connection.");
          else if (!stopped) timer = setTimeout(() => load(false), 30_000);
        });
    void load(true);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
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

  const { event, me, program, teamName, teamLogoUrl, venue, clockFormat } = data;
  const tz = event.timezone;
  // Guests aren't signed in, so their page follows the team's clock setting from here.
  setClockFormat(clockFormat);
  const mine = program.filter((p) => p.mine);
  const liveTasks = new Map((data.live?.tasks ?? []).map((t) => [t.id, t]));
  const { hero, myPart } = countdown({
    status: event.status,
    startAt: event.startAt,
    currentTaskId: data.live?.currentTaskId ?? null,
    mine: new Set(mine.map((t) => t.id)),
    now: clock + clockOffset,
    tasks: program.map((t) => ({ ...t, status: liveTasks.get(t.id)?.status, actualStartAt: liveTasks.get(t.id)?.actualStartAt })),
  });

  return (
    <main className="page guest">
      {teamLogoUrl ? (
        <p className="guest-brand">
          <img src={teamLogoUrl} alt="" className="guest-logo" />
          <span>{teamName}</span>
        </p>
      ) : (
        <>
          <p className="brand"><Logo size={24} /></p>
          <p className="muted small guest-from">{teamName}</p>
        </>
      )}
      <h1 className="guest-title">{event.name}</h1>
      <p className="event-when">{formatDate(event.startAt, tz)}</p>
      <p className="muted small">
        {formatTime(event.startAt, tz)} – {formatTime(event.endAt, tz)} · times in {tz.replace(/_/g, " ")}
      </p>
      {venue && <p className="small guest-venue">Where: {venue}</p>}

      <CountdownHero hero={hero} myPart={me.response === "declined" ? null : myPart} />

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

        {me.response === "declined" ? (
          <Alert kind="info">You've told the team you can't take part: “{me.declineReason}”.</Alert>
        ) : (
          <p className="muted small">You're down as attending.</p>
        )}
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
            {me.response === "declined" && (
              <button type="button" className="button button-primary" disabled={busy} onClick={() => respond("acknowledged")}>
                I can make it after all
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
            <li key={t.id} className={clsx("row agenda-row", t.mine && "row-mine")}>
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

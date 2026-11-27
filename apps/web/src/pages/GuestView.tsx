import { useEffect, useState } from "react";
import { Pushdown } from "../components/Pushdown";
import { useClock } from "../useClock";
import { useParams } from "react-router";
import { ApiError, api, type GuestProgram } from "../api";
import { Alert } from "../components/Form";
import { setClockFormat } from "../time";
import { Logo } from "../components/Logo";

/**
 * QR044–QR046: the guest's personal page, opened from their emailed link on a
 * phone browser. No account or app. The pushdown: one big countdown (to their part, or what's
 * on now), with Me and All below it. They're attending by default and can say they can't make
 * it from the ⋮ menu. The link expires when the event ends.
 */
export function GuestView() {
  const { token = "" } = useParams();
  const [data, setData] = useState<GuestProgram | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [clockOffset, setClockOffset] = useState(0);
  const clock = useClock().getTime();
  // Offline: the page shows the copy saved in the browser, and says when it was last updated.
  const [offline, setOffline] = useState<{ savedAt: number | null } | null>(null);
  const [lastFresh, setLastFresh] = useState<number | null>(null);

  // Save this page in the browser, so the link still opens with no connection (see public/sw.js).
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        const assets = performance.getEntriesByType("resource").map((e) => e.name).filter((u) => new URL(u).pathname.startsWith("/assets/"));
        reg.active?.postMessage({ type: "save", urls: [location.pathname, `/api/guest/${encodeURIComponent(token)}`, ...assets] });
      })
      .catch(() => undefined);
  }, [token]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (first: boolean) =>
      api<GuestProgram & { offlineSavedAt?: number }>(`/guest/${encodeURIComponent(token)}`)
        .then((d) => {
          if (stopped) return;
          setData(d);
          if (d.offlineSavedAt) {
            // The browser's saved copy: no connection.
            setOffline({ savedAt: d.offlineSavedAt });
            timer = setTimeout(() => load(false), 30_000);
            return;
          }
          setOffline(null);
          setLastFresh(Date.now());
          if (d.live) setClockOffset(Date.parse(d.live.serverTime) - Date.now());
          // Guests have no live connection: check every 15 seconds while it's on or about to start.
          const soon = Date.parse(d.event.startAt) - Date.now() < 2 * 3_600_000;
          if (d.event.status === "live" || (d.event.status === "approved" && soon)) timer = setTimeout(() => load(false), 15_000);
        })
        .catch((err) => {
          if (first && !stopped) setLoadError(err instanceof ApiError ? err.message : "Couldn't open this page. Check your connection.");
          else if (!stopped) {
            // Lost the connection: keep showing what we have, and keep trying.
            if (!(err instanceof ApiError) || err.status === 0) setOffline((o) => o ?? { savedAt: null });
            timer = setTimeout(() => load(false), 30_000);
          }
        });
    void load(true);
    // Back online: check straight away rather than waiting for the next try.
    const back = () => {
      clearTimeout(timer);
      void load(false);
    };
    window.addEventListener("online", back);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("online", back);
    };
  }, [token]);

  async function respond(response: "acknowledged" | "declined", reason?: string) {
    try {
      const res = await api<{ me: GuestProgram["me"] }>(`/guest/${encodeURIComponent(token)}/response`, {
        body: response === "declined" ? { response, reason } : { response },
      });
      setData((d) => (d ? { ...d, me: res.me } : d));
    } catch (err) {
      throw new Error(err instanceof ApiError ? (err.fields.reason ?? err.message) : "Something went wrong. Please try again.");
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

  const { event, me, program, clockFormat } = data;
  // Guests aren't signed in, so their page follows the team's clock setting from here.
  setClockFormat(clockFormat);
  const liveTasks = new Map((data.live?.tasks ?? []).map((t) => [t.id, t]));
  const declined = me.response === "declined";

  return (
    <Pushdown
      now={clock + clockOffset}
      timezone={event.timezone}
      input={{
        status: event.status,
        startAt: event.startAt,
        currentTaskId: data.live?.currentTaskId ?? null,
        // Someone who can't make it has no part to count down to.
        mine: new Set(declined ? [] : program.filter((p) => p.mine).map((p) => p.id)),
        warningMs: (data.liveWarningMinutes ?? 1) * 60_000,
        tasks: program.map((t) => ({
          id: t.id,
          title: t.title,
          durationMinutes: t.durationMinutes,
          plannedStartAt: t.startAt,
          status: liveTasks.get(t.id)?.status ?? "upcoming",
          actualStartAt: liveTasks.get(t.id)?.actualStartAt ?? null,
        })),
      }}
      // Titles and timings only: guests don't see other people's names.
      rows={program.map((t) => ({ id: t.id, title: t.title, plannedStartAt: t.startAt, durationMinutes: t.durationMinutes, people: t.mine ? "You" : null }))}
      messages={null}
      back={null}
      offline={offline && { savedAt: offline.savedAt ?? lastFresh }}
      attendance={{
        declined,
        onDecline: (reason) => respond("declined", reason),
        onAttend: () => respond("acknowledged"),
      }}
    >
      <p className="pd-muted pd-footnote">This page is just for you; please don't share the link. It stops working when the event ends.</p>
    </Pushdown>
  );
}

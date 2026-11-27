import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import clsx from "clsx";
import { allFace, faceProgress, followPlan, formatFace, meFace, PART_DONE, type Face, type FaceInput, type Tone } from "../faces";
import { formatDuration, formatTime } from "../time";

/** The pushdown's colours (the same in the app and on the lock screen). */
export const TONE_BG: Record<Tone, string> = { purple: "#460976", amber: "#f5b301", green: "#15803d", red: "#c62828" };

export interface PushdownRow {
  id: string;
  title: string;
  plannedStartAt: string;
  durationMinutes: number;
  /** "Ada Obi, You"; null when names aren't shown (guests). */
  people: string | null;
}

export interface PushdownMessage {
  id: string;
  sentBy: string;
  sentAt: string;
  body: string;
  unread: boolean;
}

type Tab = "me" | "all" | "messages";

/**
 * The event page once it's approved or live, for the people taking part: a coloured pushdown
 * holding one big countdown, then Me (your part), All (the program as it runs) and Messages.
 * Title, venue and times are left out on purpose: in the moment, they're noise.
 */
export function Pushdown(props: {
  input: Omit<FaceInput, "now">;
  now: number;
  rows: PushdownRow[];
  timezone: string;
  /** Null: no Messages tab (guests get no broadcasts). */
  messages: PushdownMessage[] | null;
  onMessagesOpened?(): void;
  back: { to: string; label: string } | null;
  /** Null: no menu (people not on the program). */
  attendance: { declined: boolean; onDecline(reason: string): Promise<void>; onAttend(): Promise<void> } | null;
  /** Lets an item open its comments (members). */
  itemLink?(id: string): string;
  /** No connection: what's shown is the saved copy (from `savedAt`), and the countdown follows the plan. */
  offline?: { savedAt: number | null } | null;
  children?: ReactNode;
}) {
  const { now, rows, timezone: tz, messages, offline } = props;
  // Offline: assume each item runs to its planned length, from the last state we heard.
  const heard = { ...props.input, now };
  const full = offline ? followPlan(heard) : heard;
  const me = meFace(full);
  const all = allFace(full);
  const [tab, setTab] = useState<Tab>(me ? "me" : "all");
  useEffect(() => {
    if (!me && tab === "me") setTab("all");
  }, [me, tab]);
  const face = tab === "all" ? all : me ?? all;
  const unread = !!messages?.some((m) => m.unread) && tab !== "messages";

  // The colour runs to the top of the screen: the browser's own bar and the page behind it follow.
  useTone(face.tone);

  const [menu, setMenu] = useState(false);
  const [declining, setDeclining] = useState(false);
  // Your part is done: a confetti popper pops up from behind the black sheet.
  const celebrate = tab === "me" && !!me && me.caption === PART_DONE;
  const header = useRef<HTMLElement>(null);
  const open = (t: Tab) => {
    setTab(t);
    if (t === "messages") props.onMessagesOpened?.();
  };

  return (
    <main className={clsx("pd", `pd-${face.tone}`)}>
      {offline && (
        <p className="pd-offline" role="status">
          <span className="pd-offline-dot" aria-hidden="true" />
          {[
            "Offline",
            offline.savedAt ? `Updated ${formatTime(new Date(offline.savedAt).toISOString(), props.timezone)}` : null,
            full.status === "live" ? "Following the plan" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      <header className={clsx("pd-top", celebrate && "pd-celebrating")} ref={header}>
        <div className="pd-buttons">
          {props.back ? (
            <Link to={props.back.to} className="pd-round" aria-label={props.back.label}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </Link>
          ) : (
            <span />
          )}
          {props.attendance && (
            <div className="pd-menu-wrap">
              <button type="button" className="pd-round" aria-label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                  <circle cx="12" cy="5" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="12" cy="19" r="1.8" />
                </svg>
              </button>
              {menu && (
                <>
                  <button type="button" className="pd-scrim" aria-label="Close menu" onClick={() => setMenu(false)} />
                  <div className="pd-menu" role="menu">
                    {props.attendance.declined ? (
                      <button type="button" role="menuitem" onClick={() => (setMenu(false), void props.attendance!.onAttend())}>
                        I can make it after all
                      </button>
                    ) : (
                      <button type="button" role="menuitem" className="pd-danger" onClick={() => (setMenu(false), setDeclining(true))}>
                        I can't make it
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <Countdown face={face} now={now} />
        {celebrate && <Celebration from={header} />}
      </header>

      <section className="pd-sheet">
        {tab === "me" && me ? (
          <MeTab rows={rows} input={full} tz={tz} latest={messages?.[0] ?? null} onOpenMessages={() => open("messages")} />
        ) : tab === "messages" && messages ? (
          <MessagesTab messages={messages} tz={tz} />
        ) : (
          <AllTab rows={rows} input={full} tz={tz} over={all.over} itemLink={props.itemLink} />
        )}
        {props.children}
      </section>

      <nav className="pd-switcher" aria-label="Event views">
        <div role="tablist">
          {me && (
            <>
              <button type="button" role="tab" aria-selected={tab === "me"} onClick={() => open("me")}>
                Me
              </button>
              <span className="pd-divider" aria-hidden="true" />
            </>
          )}
          <button type="button" role="tab" aria-selected={tab === "all"} onClick={() => open("all")}>
            All
          </button>
          {messages && (
            <>
              <span className="pd-divider" aria-hidden="true" />
              <button type="button" role="tab" className="pd-icon-tab" aria-selected={tab === "messages"} aria-label={unread ? "Messages, unread" : "Messages"} onClick={() => open("messages")}>
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                  <path fill="currentColor" d="M12 2a10 10 0 1 1-4.6 18.9l-4.3 1.6a.7.7 0 0 1-.9-.9l1.5-4.2A10 10 0 0 1 12 2z" />
                </svg>
                {unread && <span className="pd-unread" />}
              </button>
            </>
          )}
        </div>
      </nav>

      {declining && props.attendance && <DeclineDialog onClose={() => setDeclining(false)} onSend={props.attendance.onDecline} />}
    </main>
  );
}

/**
 * Your part is done. A confetti horn, hidden behind the black sheet at 70% across, swings up from
 * pointing left to 45° (up and to the left) and fires; the confetti rises inside the pushdown,
 * then falls in front of everything, over the sheet too. The horn then swings back down out of
 * sight. Each round takes 7 seconds (the rest is the pause after the confetti has fallen), three
 * rounds, then it stops. With reduced motion: the horn at rest, no confetti.
 */
const ROUND_MS = 7000;
const ROUNDS = 3;

function Celebration({ from }: { from: React.RefObject<HTMLElement | null> }) {
  const reduced = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (reduced || round >= ROUNDS) return;
    const t = setTimeout(() => setRound((r) => r + 1), ROUND_MS);
    return () => clearTimeout(t);
  }, [round, reduced]);
  if (reduced) return <Horn still />;
  if (round >= ROUNDS) return null;
  return (
    <>
      <Horn key={`horn-${round}`} />
      <Confetti key={`confetti-${round}`} from={from} />
    </>
  );
}

function Horn({ still }: { still?: boolean }) {
  return (
    <span className={clsx("pd-horn", still && "is-still")} aria-hidden="true">
      <svg viewBox="0 0 64 80" width="56" height="70">
        <defs>
          <clipPath id="pd-cone">
            <path d="M12 16 L52 16 L35 78 L29 78 Z" />
          </clipPath>
        </defs>
        <path d="M12 16 L52 16 L35 78 L29 78 Z" fill="#f5b301" />
        <g clipPath="url(#pd-cone)" fill="#ff6b6b">
          <path d="M0 30 L64 18 L64 27 L0 39 Z" />
          <path d="M0 50 L64 38 L64 47 L0 59 Z" />
          <path d="M0 70 L64 58 L64 67 L0 79 Z" />
        </g>
        <ellipse cx="32" cy="16" rx="20" ry="6" fill="#c98f00" />
        <ellipse cx="32" cy="16" rx="15.5" ry="3.8" fill="#2a1d00" />
      </svg>
    </span>
  );
}

const CONFETTI = ["#f5b301", "#4ade80", "#b98af5", "#ff6b6b", "#60a5fa", "#ffffff"];
/** Where the horn sits across the header, and where its mouth ends up at 45° (from its pivot at the tip). */
const HORN_ACROSS = 0.7;
const MOUTH_AT_REST = { dx: -39, dy: -39 };

/** One burst from the horn's mouth: up inside the pushdown, then down over everything. */
function Confetti({ from }: { from: React.RefObject<HTMLElement | null> }) {
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const box = from.current?.getBoundingClientRect();
    // The horn pivots on its tip, 18px above the header bottom (the black sheet covers the bottom 28px).
    if (box) setOrigin({ x: box.left + box.width * HORN_ACROSS + MOUTH_AT_REST.dx, y: box.bottom - 18 + MOUTH_AT_REST.dy });
  }, [from]);
  const bits = useMemo(
    () =>
      Array.from({ length: 56 }, (_, i) => {
        const room = Math.max(120, (origin?.y ?? 300) - 40);
        return {
          // Mostly up and to the left, the way the horn points.
          "--dx": `${Math.round(-110 + (Math.random() - 0.5) * 300)}px`,
          "--peak": `${Math.round(room * (0.45 + Math.random() * 0.55))}px`,
          "--fall": `${Math.round(window.innerHeight * (0.45 + Math.random() * 0.5))}px`,
          "--rot": `${Math.round((Math.random() - 0.5) * 1440)}deg`,
          "--w": `${i % 3 === 0 ? 7 : 6}px`,
          "--h": `${i % 3 === 0 ? 7 : 11}px`,
          "--r": i % 3 === 0 ? "50%" : "2px",
          background: CONFETTI[i % CONFETTI.length],
          animationDelay: `${380 + Math.round(Math.random() * 160)}ms`,
          animationDuration: `${2400 + Math.round(Math.random() * 1200)}ms`,
        } as CSSProperties;
      }),
    [origin],
  );
  if (origin === null) return null;
  return (
    <div className="pd-confetti" style={{ top: origin.y, left: origin.x }} aria-hidden="true">
      {bits.map((style, i) => (
        <span key={i} style={style} />
      ))}
    </div>
  );
}

function Countdown({ face, now }: { face: Face; now: number }) {
  const big = formatFace(face, now);
  const left = face.target !== null && !face.over && face.from !== null && !face.estimated;
  return (
    <div className="pd-count" role="timer" aria-label={`${face.caption}. ${face.estimated ? "About " : ""}${big}${left ? " left" : ""}`}>
      <p className="pd-caption">{face.caption}</p>
      <p className={clsx("pd-big", big.length > 6 && "pd-big-long", face.target === null && "pd-big-text")} aria-hidden="true">
        {face.estimated && face.target !== null && <span className="pd-unit pd-about">about</span>}
        <span>{big}</span>
        {left && <span className="pd-unit">left</span>}
      </p>
      {face.from !== null && face.target !== null && (
        <div className="pd-bar" aria-hidden="true">
          <div style={{ width: `${Math.round(faceProgress(face, now) * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

function MeTab({ rows, input, tz, latest, onOpenMessages }: { rows: PushdownRow[]; input: FaceInput; tz: string; latest: PushdownMessage | null; onOpenMessages(): void }) {
  const parts = rows.filter((r) => input.mine.has(r.id));
  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const nextUp = input.tasks.find((t) => t.status === "upcoming");
  return (
    <div className="pd-stack">
      <h2 className="pd-label">{parts.length === 1 ? "Your part" : "Your parts"}</h2>
      {parts.map((r) => {
        const t = byId.get(r.id)!;
        const done = t.status === "done" || t.status === "skipped";
        const onNow = t.status === "in_progress" && t.id === input.currentTaskId;
        const over = onNow && !!t.actualStartAt && input.now > Date.parse(t.actualStartAt) + t.durationMinutes * 60_000;
        const tag = over ? ["Over time", "red"] : onNow ? ["On now", "green"] : input.status === "live" && nextUp?.id === t.id ? ["Up next", "amber"] : null;
        return (
          <div key={r.id} className={clsx("pd-card", onNow && (over ? "is-over" : "is-on"))}>
            <span className={clsx("pd-card-time", done && "is-done")}>{formatTime(r.plannedStartAt, tz)}</span>
            <span className="pd-card-main">
              <strong className={clsx(done && "is-struck")}>{r.title}</strong>
              <span className="pd-muted">{formatDuration(r.durationMinutes)}</span>
            </span>
            {tag && <span className={`pd-tag pd-tag-${tag[1]}`}>{tag[0]}</span>}
          </div>
        );
      })}
      {latest && (
        <button type="button" className="pd-message pd-latest" onClick={onOpenMessages}>
          <span className="pd-message-head">
            <span className="pd-label">Latest message</span>
            {latest.unread && <span className="pd-dot" aria-label="Unread" />}
            <span className="pd-muted">{formatTime(latest.sentAt, tz)}</span>
          </span>
          <span className="pd-message-body">{latest.body}</span>
          <span className="pd-muted">{latest.sentBy}</span>
        </button>
      )}
    </div>
  );
}

function AllTab({ rows, input, tz, over, itemLink }: { rows: PushdownRow[]; input: FaceInput; tz: string; over: boolean; itemLink?(id: string): string }) {
  if (rows.length === 0) return <p className="pd-muted">The program hasn't been planned yet.</p>;
  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  return (
    <div>
      <h2 className="pd-label">Program</h2>
      <ol className="pd-timeline">
        {rows.map((r) => {
          const t = byId.get(r.id)!;
          const done = t.status === "done" || t.status === "skipped";
          const isNow = t.id === input.currentTaskId && t.status === "in_progress";
          const mine = input.mine.has(r.id);
          const body = (
            <>
              <strong className={clsx(done && "is-struck")}>
                {r.title}
                {isNow && <span className={clsx("pd-now", over && "is-over")}>{over ? "Over time" : "On now"}</span>}
              </strong>
              <span className={clsx("pd-sub", mine && !done && "is-mine", done && "is-struck")}>
                {[r.people, formatDuration(r.durationMinutes)].filter(Boolean).join(" · ")}
              </span>
            </>
          );
          return (
            <li key={r.id} className={clsx(done && "is-done", isNow && "is-now", isNow && over && "is-over", mine && "is-mine")}>
              <span className="pd-row-time">{formatTime(r.plannedStartAt, tz)}</span>
              <span className="pd-rail" aria-hidden="true" />
              {itemLink ? (
                <Link to={itemLink(r.id)} className="pd-row-main">
                  {body}
                </Link>
              ) : (
                <span className="pd-row-main">{body}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function MessagesTab({ messages, tz }: { messages: PushdownMessage[]; tz: string }) {
  return (
    <div className="pd-stack">
      <h2 className="pd-label">Messages</h2>
      {messages.length === 0 && <p className="pd-muted">Messages from the planners will show here.</p>}
      {messages.map((m) => (
        <article key={m.id} className="pd-message">
          <span className="pd-message-head">
            <strong>{m.sentBy}</strong>
            {m.unread && <span className="pd-dot" aria-label="Unread" />}
            <span className="pd-muted">{formatTime(m.sentAt, tz)}</span>
          </span>
          <span className="pd-message-body">{m.body}</span>
        </article>
      ))}
    </div>
  );
}

function DeclineDialog({ onClose, onSend }: { onClose(): void; onSend(reason: string): Promise<void> }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  async function send() {
    if (reason.trim().length < 3) return setError("Tell the team why you can't take part.");
    setBusy(true);
    setError(null);
    try {
      await onSend(reason.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog ref={ref} className="pd-dialog" onClose={onClose} aria-labelledby="pd-decline-title">
      <h2 id="pd-decline-title">Can't make it?</h2>
      <p className="pd-muted">Let the team know why, so they can find someone else.</p>
      <label htmlFor="pd-reason" className="pd-label">
        Reason
      </label>
      <textarea id="pd-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && (
        <p className="pd-error" role="alert">
          {error}
        </p>
      )}
      <div className="pd-dialog-actions">
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="button button-primary" disabled={busy} onClick={send}>
          {busy ? "Sending…" : "Tell the team"}
        </button>
      </div>
    </dialog>
  );
}

/** Paints the browser's bar (theme-color) and the page behind it in the pushdown's colour. */
function useTone(tone: Tone) {
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const before = meta?.content ?? null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = TONE_BG[tone];
    const bodyBefore = document.body.style.backgroundColor;
    document.body.style.backgroundColor = TONE_BG[tone];
    return () => {
      if (before === null) meta!.remove();
      else meta!.content = before;
      document.body.style.backgroundColor = bodyBefore;
    };
  }, [tone]);
}

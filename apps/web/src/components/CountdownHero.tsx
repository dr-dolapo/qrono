import clsx from "clsx";
import type { Hero, MyPart } from "../countdown";
import { isLong } from "../countdown";
import { formatStartsIn } from "../useLiveEvent";
import { Countdown } from "./Countdown";

/** A wait readable at a glance: "3 days" / "5 h 20 min" far out, a ticking clock in the last hour. */
function Wait({ ms }: { ms: number }) {
  return isLong(ms) ? <>{formatStartsIn(ms)}</> : <Countdown ms={ms} />;
}

/**
 * The biggest thing on a participant's page: how long until the event starts, or what's on now
 * and how long it has left. Below it, in purple, the countdown to their own part, when that's
 * a different moment.
 */
export function CountdownHero({ hero, myPart, reconnecting }: { hero: Hero; myPart: MyPart; reconnecting?: boolean }) {
  return (
    <section className="cd" aria-live="polite" aria-atomic="false">
      <div className={clsx("cd-hero", hero.kind === "now" && "is-live", "mine" in hero && hero.mine && "is-mine")}>
        {hero.kind === "starts" && (
          <>
            <span className="cd-label">{hero.mine ? "Your part starts in" : "The event starts in"}</span>
            <strong className="cd-big">{hero.ms > 0 ? <Wait ms={hero.ms} /> : "Any moment"}</strong>
            {hero.mine && hero.title && <span className="cd-title">You’re first: {hero.title}</span>}
          </>
        )}
        {hero.kind === "now" && (
          <>
            <span className="cd-label">
              <span className="live-dot" /> {hero.mine ? "You’re on now" : "On now"}
            </span>
            <span className="cd-title">{hero.title}</span>
            {hero.ms !== null && (
              <>
                <strong className={clsx("cd-big", hero.ms < 0 && "is-over")}>
                  <Countdown ms={hero.ms} />
                </strong>
                <span className="cd-sub">{hero.ms < 0 ? "over time" : "left"}</span>
              </>
            )}
          </>
        )}
        {hero.kind === "wrapping-up" && (
          <>
            <span className="cd-label">
              <span className="live-dot" /> Live
            </span>
            <strong className="cd-title">All items are done</strong>
          </>
        )}
        {hero.kind === "ended" && <strong className="cd-title">This event has ended</strong>}
        {reconnecting && <span className="cd-sub">Reconnecting…</span>}
      </div>

      {myPart?.kind === "upcoming" && (
        <div className="cd-mine">
          <span className="cd-label">{myPart.estimated ? "Your part in about" : "Your part in"}</span>
          <strong className="cd-mid">
            <Wait ms={Math.max(0, myPart.ms)} />
          </strong>
          <span className="cd-title">{myPart.title}</span>
        </div>
      )}
      {myPart?.kind === "done" && (
        <div className="cd-mine">
          <strong className="cd-title">Your part is done. Thank you!</strong>
        </div>
      )}
    </section>
  );
}

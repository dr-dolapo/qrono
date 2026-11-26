import { StyleSheet, Text, View } from "react-native";
import { useLiveEvent } from "../live/useLiveEvent";
import { useNow } from "../lib/useNow";
import { colors, font, radius, space } from "../theme";
import { countdown, isLong, type Hero, type MyPart } from "./countdown";
import type { EventDetail } from "./types";

/** "3 days", "5 h 20 min", or "12:34" in the last hour. */
function wait(ms: number): string {
  const abs = Math.abs(ms);
  if (isLong(abs)) {
    const hours = abs / 3_600_000;
    if (hours >= 48) return `${Math.floor(hours / 24)} days`;
    const h = Math.floor(hours);
    const m = Math.floor((abs % 3_600_000) / 60_000);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const total = Math.floor(abs / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The biggest thing on the event screen once it's approved or live: the countdown to the start,
 * or what's on now and how long is left. Your own part has its own purple countdown beneath it,
 * unless it's the same moment (you're first, or you're on now).
 */
export function CountdownPanel({ data }: { data: EventDetail }) {
  const { state, clockOffset } = useLiveEvent(data.event.id);
  const now = useNow(1000) + clockOffset;
  const me = data.me.participant;
  const mine = new Set(me ? data.tasks.filter((t) => t.assigneeIds.includes(me.id)).map((t) => t.id) : []);
  const live = new Map((state?.tasks ?? []).map((t) => [t.id, t]));
  const { hero, myPart } = countdown({
    status: state?.event.status ?? data.event.status,
    startAt: data.event.startAt,
    currentTaskId: state?.currentTaskId ?? null,
    mine,
    now,
    tasks: data.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      durationMinutes: t.durationMinutes,
      startAt: t.startAt,
      status: live.get(t.id)?.status,
      actualStartAt: live.get(t.id)?.actualStartAt,
    })),
  });
  return (
    <View style={{ gap: space.sm, marginTop: space.md }}>
      <HeroCard hero={hero} />
      {me?.response !== "declined" ? <MyPartCard part={myPart} /> : null}
    </View>
  );
}

function HeroCard({ hero }: { hero: Hero }) {
  const mineNow = "mine" in hero && hero.mine;
  if (hero.kind === "ended" || hero.kind === "wrapping-up") {
    return (
      <View style={styles.hero}>
        <Text style={styles.title}>{hero.kind === "ended" ? "This event has ended" : "All items are done"}</Text>
      </View>
    );
  }
  const label = hero.kind === "starts" ? (hero.mine ? "Your part starts in" : "The event starts in") : hero.mine ? "You're on now" : "On now";
  const over = hero.kind === "now" && hero.ms !== null && hero.ms < 0;
  const big = hero.kind === "starts" ? (hero.ms > 0 ? wait(hero.ms) : "Any moment") : hero.ms !== null ? `${over ? "+" : ""}${wait(hero.ms)}` : null;
  return (
    <View style={[styles.hero, hero.kind === "now" && styles.heroLive, mineNow && styles.heroMine]} accessible accessibilityLabel={`${label}${hero.kind === "now" ? `: ${hero.title}` : ""}. ${big ?? ""}${hero.kind === "now" && big ? (over ? " over time" : " left") : ""}`}>
      <Text style={[styles.label, mineNow && styles.labelMine]}>{label}</Text>
      {hero.kind === "now" ? <Text style={styles.title}>{hero.title}</Text> : null}
      {big ? <Text style={[styles.big, over && styles.over]}>{big}</Text> : null}
      {hero.kind === "now" && big ? <Text style={styles.muted}>{over ? "over time" : "left"}</Text> : null}
      {hero.kind === "starts" && hero.mine && hero.title ? <Text style={styles.title}>You're first: {hero.title}</Text> : null}
    </View>
  );
}

function MyPartCard({ part }: { part: MyPart }) {
  if (!part) return null;
  if (part.kind === "done") {
    return (
      <View style={styles.mine}>
        <Text style={styles.title}>Your part is done. Thank you!</Text>
      </View>
    );
  }
  const label = part.estimated ? "Your part in about" : "Your part in";
  return (
    <View style={styles.mine} accessible accessibilityLabel={`${label} ${wait(Math.max(0, part.ms))}: ${part.title}`}>
      <Text style={[styles.label, styles.labelMine]}>{label}</Text>
      <Text style={styles.mid}>{wait(Math.max(0, part.ms))}</Text>
      <Text style={styles.title}>{part.title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: 4 },
  heroLive: { borderColor: "rgba(72,176,44,0.5)" },
  heroMine: { borderColor: "#a44be9", backgroundColor: "#1d1030" },
  mine: { backgroundColor: "#1d1030", borderRadius: radius.lg, borderWidth: 1, borderColor: "#4a2a78", padding: space.lg, gap: 4 },
  label: { color: colors.muted, fontSize: 12, letterSpacing: 0.8, textTransform: "uppercase", ...font("700") },
  labelMine: { color: "#d3b6fa" },
  big: { color: colors.text, fontSize: 60, lineHeight: 66, letterSpacing: -1.5, fontVariant: ["tabular-nums"], ...font("800") },
  over: { color: colors.danger },
  mid: { color: "#e9dbff", fontSize: 34, lineHeight: 40, letterSpacing: -0.5, fontVariant: ["tabular-nums"], ...font("800") },
  title: { color: colors.text, fontSize: 17, lineHeight: 23, ...font("600") },
  muted: { color: colors.muted, fontSize: 14, ...font("400") },
});

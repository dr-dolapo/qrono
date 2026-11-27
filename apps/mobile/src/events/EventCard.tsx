import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View, type TextLayoutEvent } from "react-native";
import { StatusPill } from "../components/StatusPill";
import { formatRange, formatTime, shortCountdown } from "../lib/time";
import { colors, font, radius, space } from "../theme";
import type { MyEvent } from "./types";

export function EventCard({ event, now }: { event: MyEvent; now: number }) {
  const startsLater = Date.parse(event.startAt) > now && (event.status === "approved" || event.status === "review" || event.status === "draft");
  const needsReply = event.myResponse === "pending" && (event.status === "approved" || event.status === "live");

  const ended = event.status === "past";
  let note: { text: string; tone: "muted" | "attention" } | null = null;
  if (event.awaitingMyApproval) note = { text: "Waiting for your approval", tone: "attention" };
  else if (needsReply) note = { text: "Please confirm you can take part", tone: "attention" };
  else if (event.myNextTask)
    note = { text: `Your next task: ${event.myNextTask.title} · ${formatTime(event.myNextTask.startAt, event.timezone)}`, tone: "muted" };
  else if (event.myResponse && event.status !== "past") note = { text: "No tasks assigned to you yet", tone: "muted" };

  return (
    <Pressable
      // Approved and live events open on the pushdown (the live view), so one screen is enough.
      onPress={() => router.push({ pathname: "/events/[id]", params: { id: event.id, team: event.team.name } })}
      accessibilityRole="button"
      accessibilityHint="Opens the event's program"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.top}>
        <StatusPill status={event.status} />
        {startsLater && event.status === "approved" ? (
          <Text style={styles.countdown}>Starts {shortCountdown(event.startAt, now)}</Text>
        ) : null}
      </View>
      {ended ? <Struck text={event.name} /> : <Text style={styles.name}>{event.name}</Text>}
      <Text style={styles.meta}>
        {event.team.name} · {formatRange(event.startAt, event.endAt, event.timezone)}
      </Text>
      {note ? <Text style={[styles.note, note.tone === "attention" && styles.attention, ended && styles.endedText]}>{note.text}</Text> : null}
    </Pressable>
  );
}

const ENDED = "#6b7180";
/** About 1.5x the line React Native draws for line-through at this size, which it can't thicken. */
const STRIKE = 2;

/** An ended event's name: grey, struck through with a thicker grey line (one per wrapped line). */
function Struck({ text }: { text: string }) {
  const [lines, setLines] = useState<TextLayoutEvent["nativeEvent"]["lines"]>([]);
  return (
    <View>
      <Text style={[styles.name, styles.endedText]} onTextLayout={(e) => setLines(e.nativeEvent.lines)} accessibilityLabel={`${text}, ended`}>
        {text}
      </Text>
      {lines.map((l, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={[styles.strike, { left: l.x, top: l.y + l.height * 0.54 - STRIKE / 2, width: l.width }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  endedText: { color: ENDED },
  strike: { position: "absolute", height: STRIKE, borderRadius: STRIKE / 2, backgroundColor: ENDED },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: 6,
  },
  pressed: { opacity: 0.75 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  countdown: { color: colors.accent, fontSize: 13, ...font("600") },
  name: { color: colors.text, fontSize: 18, ...font("700"), marginTop: 2 },
  meta: { color: colors.muted, fontSize: 14, ...font("400"), lineHeight: 20 },
  note: { color: colors.text, fontSize: 14, ...font("400"), marginTop: 2 },
  attention: { color: colors.warningText, ...font("600") },
});

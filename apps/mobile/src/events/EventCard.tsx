import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusPill } from "../components/StatusPill";
import { formatRange, formatTime, shortCountdown } from "../lib/time";
import { colors, radius, space } from "../theme";
import type { MyEvent } from "./types";

export function EventCard({ event, now }: { event: MyEvent; now: number }) {
  const startsLater = Date.parse(event.startAt) > now && (event.status === "approved" || event.status === "review" || event.status === "draft");
  const needsReply = event.myResponse === "pending" && (event.status === "approved" || event.status === "live");

  let note: { text: string; tone: "muted" | "attention" } | null = null;
  if (event.awaitingMyApproval) note = { text: "Waiting for your approval", tone: "attention" };
  else if (needsReply) note = { text: "Please confirm you can take part", tone: "attention" };
  else if (event.myNextTask)
    note = { text: `Your next task: ${event.myNextTask.title} · ${formatTime(event.myNextTask.startAt, event.timezone)}`, tone: "muted" };
  else if (event.myResponse && event.status !== "past") note = { text: "No tasks assigned to you yet", tone: "muted" };

  return (
    <Pressable
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
      <Text style={styles.name}>{event.name}</Text>
      <Text style={styles.meta}>
        {event.team.name} · {formatRange(event.startAt, event.endAt, event.timezone)}
      </Text>
      {note ? <Text style={[styles.note, note.tone === "attention" && styles.attention]}>{note.text}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
  countdown: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  name: { color: colors.text, fontSize: 18, fontWeight: "700", marginTop: 2 },
  meta: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  note: { color: colors.text, fontSize: 14, marginTop: 2 },
  attention: { color: colors.warningText, fontWeight: "600" },
});

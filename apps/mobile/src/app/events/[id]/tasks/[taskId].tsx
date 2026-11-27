import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Button } from "../../../../components/Button";
import { Screen } from "../../../../components/Screen";
import type { EventDetail } from "../../../../events/types";
import { formatDate, formatDuration, formatTime } from "../../../../lib/time";
import { eventCheckEvery, useCachedApi } from "../../../../lib/useCachedApi";
import { colors, font, space } from "../../../../theme";

/** One task: when it is, how long, who runs it and its notes. */
export default function TaskScreen() {
  const { id, taskId } = useLocalSearchParams<{ id: string; taskId: string }>();
  const path = `/events/${encodeURIComponent(id)}`;
  // The same saved copy as the event screen, so an item opens instantly, even offline.
  const { data, error, loading, refresh } = useCachedApi<EventDetail>(path, `event:${id}`, (d) => eventCheckEvery(d?.event));

  const task = data?.tasks.find((t) => t.id === taskId);
  const names = useMemo(() => new Map((data?.participants ?? []).map((p) => [p.id, p.name])), [data]);
  const myParticipantId = data?.me.participant?.id ?? null;

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }
  if (!data || !task) {
    return (
      <View style={[styles.center, { padding: space.xl, gap: space.md }]}>
        <Text style={styles.heading}>{data ? "This task is no longer in the program" : "Couldn't open this task"}</Text>
        {error ? <Text style={styles.muted}>{error.message}</Text> : null}
        {!data ? <Button label="Try again" variant="secondary" onPress={refresh} /> : null}
      </View>
    );
  }

  const tz = data.event.timezone;
  const people = task.assigneeIds.map((pid) => (pid === myParticipantId ? "You" : names.get(pid) ?? "Someone"));

  return (
    <Screen>
      <Stack.Screen options={{ title: task.title }} />
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {task.title}
        </Text>
        <Text style={styles.when}>
          {formatTime(task.startAt, tz)} – {formatTime(task.endAt, tz)} · {(task.durationMinutes === null ? "No length yet" : formatDuration(task.durationMinutes))}
        </Text>
        <Text style={styles.muted}>
          {data.event.name} · {formatDate(task.startAt, tz)}
        </Text>
        {people.length ? <Text style={styles.people}>{people.join(", ")}</Text> : <Text style={styles.muted}>Nobody assigned yet</Text>}
        {task.description ? <Text style={styles.description}>{task.description}</Text> : null}
      </View>

    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  header: { gap: 6, marginBottom: space.sm },
  title: { color: colors.text, fontSize: 24, ...font("800") },
  when: { color: colors.text, fontSize: 16, ...font("400"), fontVariant: ["tabular-nums"] },
  muted: { color: colors.muted, fontSize: 13, ...font("400"), lineHeight: 18 },
  people: { color: colors.accent, fontSize: 14, ...font("600") },
  description: { color: colors.text, fontSize: 15, ...font("400"), lineHeight: 22, marginTop: space.xs },
  heading: { color: colors.text, fontSize: 20, ...font("700"), marginTop: space.md },
});

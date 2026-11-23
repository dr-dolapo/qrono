import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { StatusPill } from "../../components/StatusPill";
import type { EventDetail } from "../../events/types";
import { countdownTo, deviceTimeZone, formatDuration, formatRange, formatTime, zoneCity } from "../../lib/time";
import { useApi } from "../../lib/useApi";
import { useNow } from "../../lib/useNow";
import { colors, radius, space } from "../../theme";

type Filter = "all" | "mine";
type Task = EventDetail["tasks"][number];

/** QR023 the event's program, QR024 filtered to my tasks, QR025 the countdown to the start. */
export default function EventScreen() {
  const { id, team } = useLocalSearchParams<{ id: string; team?: string }>();
  const { data, error, loading, refreshing, refresh } = useApi<EventDetail>(`/events/${encodeURIComponent(id)}`);
  const [filter, setFilter] = useState<Filter>("all");

  const myParticipantId = data?.me.participant?.id ?? null;
  const names = useMemo(() => new Map((data?.participants ?? []).map((p) => [p.id, p.name])), [data]);
  const stages = useMemo(() => new Map((data?.stages ?? []).map((s) => [s.id, s.name])), [data]);
  const myTasks = useMemo(
    () => (data?.tasks ?? []).filter((t) => myParticipantId !== null && t.assigneeIds.includes(myParticipantId)),
    [data, myParticipantId],
  );
  const tasks = filter === "mine" ? myTasks : data?.tasks ?? [];

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "" }} />
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }
  if (!data) {
    return (
      <View style={[styles.center, { padding: space.xl, gap: space.md }]}>
        <Stack.Screen options={{ title: "" }} />
        <Text style={styles.cardTitle}>Couldn't open this event</Text>
        <Text style={[styles.muted, { textAlign: "center" }]}>{error?.message}</Text>
        <Button label="Try again" variant="secondary" onPress={refresh} />
      </View>
    );
  }

  const { event } = data;
  return (
    <>
      <Stack.Screen options={{ title: event.name }} />
      <FlatList
        style={styles.screen}
        contentContainerStyle={styles.content}
        data={tasks}
        keyExtractor={(t) => t.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <StatusPill status={event.status} />
            <Text style={styles.title} accessibilityRole="header">
              {event.name}
            </Text>
            {team ? <Text style={styles.muted}>{team}</Text> : null}
            <Text style={styles.when}>{formatRange(event.startAt, event.endAt, event.timezone)}</Text>
            {event.timezone !== deviceTimeZone() ? (
              <Text style={styles.muted}>Times are in {zoneCity(event.timezone)} time.</Text>
            ) : null}
            {event.description ? <Text style={styles.description}>{event.description}</Text> : null}

            <StartPanel status={event.status} startAt={event.startAt} />
            <MyPart data={data} myTaskCount={myTasks.length} />

            <View style={styles.programHeader}>
              <Text style={styles.sectionTitle}>Program</Text>
              {myParticipantId ? <FilterToggle value={filter} onChange={setFilter} mineCount={myTasks.length} /> : null}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <TaskRow
            task={item}
            timezone={event.timezone}
            mine={myParticipantId !== null && item.assigneeIds.includes(myParticipantId)}
            people={item.assigneeIds.map((pid) => (pid === myParticipantId ? "You" : names.get(pid) ?? "Someone"))}
            stage={item.stageId ? stages.get(item.stageId) ?? null : null}
          />
        )}
        ListEmptyComponent={
          <Text style={[styles.muted, { marginTop: space.md }]}>
            {filter === "mine" ? "You have no tasks in this event." : "The program hasn't been planned yet."}
          </Text>
        }
      />
    </>
  );
}

/** QR025: a live countdown before the start; a clear state once it's live or over. */
function StartPanel({ status, startAt }: { status: EventDetail["event"]["status"]; startAt: string }) {
  const now = useNow(1000);
  if (status === "live") {
    return (
      <View style={[styles.panel, styles.livePanel]}>
        <Text style={styles.liveText}>This event is live now</Text>
      </View>
    );
  }
  if (status === "past") return null;
  const left = countdownTo(startAt, now);
  if (!left) return null;
  const units: [number, string][] = [
    [left.days, left.days === 1 ? "day" : "days"],
    [left.hours, "hours"],
    [left.minutes, "min"],
    [left.seconds, "sec"],
  ];
  const label = status === "approved" ? "Starts in" : "Planned to start in";
  return (
    <View
      style={styles.panel}
      accessible
      accessibilityLabel={`${label} ${left.days} days, ${left.hours} hours and ${left.minutes} minutes`}
    >
      <Text style={styles.panelLabel}>{label}</Text>
      <View style={styles.countdownRow}>
        {units.map(([n, unit]) => (
          <View key={unit} style={styles.unit}>
            <Text style={styles.unitNumber}>{String(n).padStart(2, "0")}</Text>
            <Text style={styles.unitLabel}>{unit}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Where I stand in this event. Replying to the invitation comes in the next step. */
function MyPart({ data, myTaskCount }: { data: EventDetail; myTaskCount: number }) {
  const participant = data.me.participant;
  if (!participant) return null;
  const published = data.event.status === "approved" || data.event.status === "live";
  const reply =
    participant.response === "acknowledged"
      ? "You've confirmed you're taking part."
      : participant.response === "declined"
        ? "You said you can't take part."
        : published
          ? "The organisers are waiting for you to confirm."
          : null;
  const tasks = myTaskCount === 0 ? "No tasks are assigned to you yet." : `You have ${myTaskCount} ${myTaskCount === 1 ? "task" : "tasks"}.`;
  return (
    <View style={styles.myPart}>
      <Text style={styles.cardTitle}>Your part</Text>
      <Text style={styles.body}>{tasks}</Text>
      {reply ? <Text style={[styles.body, participant.response === "pending" && styles.attention]}>{reply}</Text> : null}
    </View>
  );
}

function FilterToggle({ value, onChange, mineCount }: { value: Filter; onChange(f: Filter): void; mineCount: number }) {
  const options: [Filter, string][] = [
    ["all", "All"],
    ["mine", `Mine (${mineCount})`],
  ];
  return (
    <View style={styles.toggle} accessibilityRole="tablist">
      {options.map(([key, label]) => {
        const selected = value === key;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={[styles.toggleOption, selected && styles.toggleSelected]}
          >
            <Text style={[styles.toggleText, selected && styles.toggleTextSelected]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function TaskRow({ task, timezone, mine, people, stage }: { task: Task; timezone: string; mine: boolean; people: string[]; stage: string | null }) {
  const finished = task.status === "done" || task.status === "skipped";
  const onNow = task.status === "in_progress";
  return (
    <View style={[styles.task, mine && styles.taskMine, finished && styles.taskDone]}>
      <View style={styles.taskTime}>
        <Text style={styles.time}>{formatTime(task.startAt, timezone)}</Text>
        <Text style={styles.duration}>{formatDuration(task.durationMinutes)}</Text>
      </View>
      <View style={styles.taskBody}>
        <View style={styles.taskTitleRow}>
          <Text style={[styles.taskTitle, finished && styles.strike]}>{task.title}</Text>
          {onNow ? <Text style={styles.nowChip}>On now</Text> : null}
          {task.status === "skipped" ? <Text style={styles.muted}>Skipped</Text> : null}
        </View>
        {task.description ? (
          <Text style={styles.taskDescription} numberOfLines={3}>
            {task.description}
          </Text>
        ) : null}
        {people.length > 0 ? <Text style={[styles.people, mine && styles.peopleMine]}>{people.join(", ")}</Text> : null}
        {stage ? <Text style={styles.muted}>{stage}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.xl, paddingBottom: space.xxl * 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  header: { gap: space.sm, marginBottom: space.md },
  title: { color: colors.text, fontSize: 26, fontWeight: "800", marginTop: space.xs },
  when: { color: colors.text, fontSize: 16 },
  muted: { color: colors.muted, fontSize: 13 },
  description: { color: colors.text, fontSize: 15, lineHeight: 22, marginTop: space.xs },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  attention: { color: colors.warningText, fontWeight: "600" },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  panel: { marginTop: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  livePanel: { backgroundColor: colors.liveSurface },
  liveText: { color: colors.live, fontSize: 16, fontWeight: "700" },
  panelLabel: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  countdownRow: { flexDirection: "row", justifyContent: "space-between" },
  unit: { alignItems: "center", minWidth: 60 },
  unitNumber: { color: colors.text, fontSize: 32, fontWeight: "800", fontVariant: ["tabular-nums"] },
  unitLabel: { color: colors.muted, fontSize: 12 },
  myPart: { marginTop: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: 6 },
  programHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.xl },
  sectionTitle: { color: colors.text, fontSize: 20, fontWeight: "700" },
  toggle: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: 999, padding: 3 },
  toggleOption: { paddingHorizontal: space.md, minHeight: 36, justifyContent: "center", borderRadius: 999 },
  toggleSelected: { backgroundColor: colors.accent },
  toggleText: { color: colors.muted, fontSize: 14, fontWeight: "600" },
  toggleTextSelected: { color: colors.onAccent },
  separator: { height: space.sm },
  task: { flexDirection: "row", gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surface },
  taskMine: { backgroundColor: colors.mineSurface },
  taskDone: { opacity: 0.55 },
  taskTime: { width: 58 },
  time: { color: colors.text, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  duration: { color: colors.muted, fontSize: 12, marginTop: 2 },
  taskBody: { flex: 1, gap: 3 },
  taskTitleRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  taskTitle: { color: colors.text, fontSize: 16, fontWeight: "600", flexShrink: 1 },
  strike: { textDecorationLine: "line-through" },
  nowChip: { color: colors.live, fontSize: 12, fontWeight: "700" },
  taskDescription: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  people: { color: colors.muted, fontSize: 13 },
  peopleMine: { color: colors.accent, fontWeight: "600" },
});

import { Stack, router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Button } from "../../../components/Button";
import { StatusPill } from "../../../components/StatusPill";
import { ApprovalPanel } from "../../../events/ApprovalPanel";
import { PushdownScreen } from "../../../events/Pushdown";
import { DraftEditor } from "../../../program/DraftEditor";
import { RespondPanel } from "../../../events/RespondPanel";
import type { EventDetail } from "../../../events/types";
import { ApiError, api } from "../../../lib/api";
import { removeCache } from "../../../lib/cache";
import { countdownTo, deviceTimeZone, formatDuration, formatRange, formatTime, zoneCity } from "../../../lib/time";
import { eventCheckEvery, useCachedApi } from "../../../lib/useCachedApi";
import { useNow } from "../../../lib/useNow";
import { colors, font, radius, space } from "../../../theme";

type Filter = "all" | "mine";
type Task = EventDetail["tasks"][number];

/** QR023 the event's program, QR024 filtered to my tasks, QR025 the countdown to the start. */
export default function EventScreen() {
  const { id, team } = useLocalSearchParams<{ id: string; team?: string }>();
  // The saved copy first (instant, and offline), then a check for changes: every minute on the
  // day, every 5 minutes before that.
  const { data, error, loading, refreshing, refresh, setData, savedAt } = useCachedApi<EventDetail>(
    `/events/${encodeURIComponent(id)}`,
    `event:${id}`,
    (d) => eventCheckEvery(d?.event),
  );
  const [filter, setFilter] = useState<Filter>("all");

  const myParticipantId = data?.me.participant?.id ?? null;
  const names = useMemo(() => new Map((data?.participants ?? []).map((p) => [p.id, p.name])), [data]);
  const stages = useMemo(() => new Map((data?.stages ?? []).map((s) => [s.id, s.name])), [data]);
  const myTasks = useMemo(
    () => (data?.tasks ?? []).filter((t) => myParticipantId !== null && t.assigneeIds.includes(myParticipantId)),
    [data, myParticipantId],
  );
  const tasks = filter === "mine" ? myTasks : data?.tasks ?? [];
  const commentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const cm of data?.comments ?? []) counts.set(cm.taskId, (counts.get(cm.taskId) ?? 0) + 1);
    return counts;
  }, [data]);

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
  // Approved or live: the pushdown screen (one big countdown; Me, All and Messages below it).
  // Drafts open in the program builder for the Admins and Planners who can edit them.
  if (event.status === "draft" && data.permissions.canEdit) {
    return <DraftEditor data={data} onUpdated={setData} refresh={refresh} savedAt={savedAt} />;
  }
  if (event.status === "approved" || event.status === "live") {
    return <PushdownScreen data={data} onUpdated={setData} refresh={refresh} savedAt={savedAt} />;
  }
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

            <StartPanel status={event.status} startAt={event.startAt} />
            {event.description ? <Text style={styles.description}>{event.description}</Text> : null}

            <ApprovalPanel data={data} onApproved={setData} />
            <RespondPanel data={data} myTaskCount={myTasks.length} onUpdated={setData} />

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
            comments={commentCounts.get(item.id) ?? 0}
            onPress={() =>
              router.push({ pathname: "/events/[id]/tasks/[taskId]", params: { id: event.id, taskId: item.id } })
            }
          />
        )}
        ListEmptyComponent={
          <Text style={[styles.muted, { marginTop: space.md }]}>
            {filter === "mine" ? "You have no tasks in this event." : "The program hasn't been planned yet."}
          </Text>
        }
        ListFooterComponent={data.permissions.canDelete ? <DeleteEvent eventId={event.id} past={event.status === "past"} /> : undefined}
      />
    </>
  );
}

/**
 * Admins and Planners: delete a past event (or a draft), to take it off everyone's list.
 * Nobody is notified. Asks first, since it can't be undone.
 */
function DeleteEvent({ eventId, past }: { eventId: string; past: boolean }) {
  const [busy, setBusy] = useState(false);
  const confirm = () =>
    Alert.alert(
      past ? "Delete this event?" : "Delete this draft?",
      past
        ? "It comes off everyone's list, with its program, messages and comments. Nobody is notified. This can't be undone."
        : "The draft and its program are deleted. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await api(`/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
              for (const key of [`event:${eventId}`, `broadcasts:${eventId}`, `live:${eventId}`]) removeCache(key);
              if (router.canGoBack()) router.back();
              else router.replace("/");
            } catch (err) {
              setBusy(false);
              Alert.alert("Couldn't delete the event", err instanceof ApiError ? err.message : "Please try again.");
            }
          },
        },
      ],
    );
  return (
    <View style={styles.deleteWrap}>
      <Button label={busy ? "Deleting…" : past ? "Delete event" : "Delete draft"} variant="link" onPress={confirm} disabled={busy} />
    </View>
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

interface TaskRowProps {
  task: Task;
  timezone: string;
  mine: boolean;
  people: string[];
  stage: string | null;
  comments: number;
  onPress(): void;
}

function TaskRow({ task, timezone, mine, people, stage, comments, onPress }: TaskRowProps) {
  const finished = task.status === "done" || task.status === "skipped";
  const onNow = task.status === "in_progress";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Opens the task and its comments"
      style={({ pressed }) => [styles.task, mine && styles.taskMine, finished && styles.taskDone, pressed && styles.pressed]}
    >
      <View style={styles.taskTime}>
        <Text style={styles.time}>{formatTime(task.startAt, timezone)}</Text>
        <Text style={styles.duration}>{(task.durationMinutes === null ? "No length yet" : formatDuration(task.durationMinutes))}</Text>
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
        <Text style={styles.commentCount}>
          {comments === 0 ? "Add a comment" : `${comments} ${comments === 1 ? "comment" : "comments"}`}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  deleteWrap: { marginTop: space.xl, marginBottom: space.xxl, alignItems: "center" },
  screen: { flex: 1, backgroundColor: "transparent" },
  content: { padding: space.xl, paddingBottom: space.xxl * 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  header: { gap: space.sm, marginBottom: space.md },
  title: { color: colors.text, fontSize: 26, ...font("800"), marginTop: space.xs },
  when: { color: colors.text, fontSize: 16 , ...font("400")},
  muted: { color: colors.muted, fontSize: 13 , ...font("400")},
  description: { color: colors.text, fontSize: 15, ...font("400"), lineHeight: 22, marginTop: space.xs },
  cardTitle: { color: colors.text, fontSize: 16, ...font("700") },
  panel: { marginTop: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  livePanel: { backgroundColor: colors.liveSurface },
  liveText: { color: colors.live, fontSize: 16, ...font("700") },
  panelLabel: { color: colors.muted, fontSize: 13, ...font("600") },
  countdownRow: { flexDirection: "row", justifyContent: "space-between" },
  unit: { alignItems: "center", minWidth: 60 },
  unitNumber: { color: colors.text, fontSize: 32, ...font("800"), fontVariant: ["tabular-nums"] },
  unitLabel: { color: colors.muted, fontSize: 12 , ...font("400")},
  programHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.xl },
  sectionTitle: { color: colors.text, fontSize: 20, ...font("700") },
  toggle: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: 999, padding: 3 },
  toggleOption: { paddingHorizontal: space.md, minHeight: 36, justifyContent: "center", borderRadius: 999 },
  toggleSelected: { backgroundColor: colors.accent },
  toggleText: { color: colors.muted, fontSize: 14, ...font("600") },
  toggleTextSelected: { color: colors.onAccent },
  separator: { height: space.sm },
  task: { flexDirection: "row", gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surface },
  taskMine: { backgroundColor: colors.mineSurface },
  taskDone: { opacity: 0.55 },
  taskTime: { width: 58 },
  time: { color: colors.text, fontSize: 15, ...font("700"), fontVariant: ["tabular-nums"] },
  duration: { color: colors.muted, fontSize: 12, ...font("400"), marginTop: 2 },
  taskBody: { flex: 1, gap: 3 },
  taskTitleRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  taskTitle: { color: colors.text, fontSize: 16, ...font("600"), flexShrink: 1 },
  strike: { textDecorationLine: "line-through" },
  nowChip: { color: colors.live, fontSize: 12, ...font("700") },
  taskDescription: { color: colors.muted, fontSize: 14, ...font("400"), lineHeight: 19 },
  people: { color: colors.muted, fontSize: 13 , ...font("400")},
  peopleMine: { color: colors.accent, ...font("600") },
  commentCount: { color: colors.accent, fontSize: 13, ...font("400"), marginTop: 2 },
  pressed: { opacity: 0.75 },
});

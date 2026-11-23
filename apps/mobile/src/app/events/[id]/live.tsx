import { Stack, router, useLocalSearchParams } from "expo-router";
import { useKeepAwake } from "expo-keep-awake";
import { useMemo } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../../../components/Button";
import type { EventDetail } from "../../../events/types";
import { formatTime, shortCountdown } from "../../../lib/time";
import { useApi } from "../../../lib/useApi";
import { useNow } from "../../../lib/useNow";
import { formatClock, liveView, useLiveEvent, type LiveConnection, type LiveTask } from "../../../live/useLiveEvent";
import { colors, radius, space } from "../../../theme";

/**
 * The participant's live view: what's on now, what's next and when I'm up,
 * kept in sync with the command centre over a WebSocket.
 */
export default function LiveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // The screen stays on while someone is following the event.
  useKeepAwake();
  const detail = useApi<EventDetail>(`/events/${encodeURIComponent(id)}`);
  const { connection, state, clockOffset } = useLiveEvent(id, (msg) => {
    // The organisers changed the plan: refresh who's on which task.
    if (msg.type === "plan-changed") void detail.refresh();
  });
  const now = useNow(1000) + clockOffset;

  const mine = useMemo(() => {
    const pid = detail.data?.me.participant?.id;
    return new Set(pid ? detail.data!.tasks.filter((t) => t.assigneeIds.includes(pid)).map((t) => t.id) : []);
  }, [detail.data]);

  if (!state) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Live" }} />
        <ActivityIndicator color={colors.muted} />
        <Text style={styles.muted}>{connection === "reconnecting" ? "Can't reach Qrono. Trying again…" : "Connecting to the live event…"}</Text>
      </View>
    );
  }

  const tz = state.event.timezone;
  const view = liveView(state, now);
  const myUpcoming = view.upcoming.filter((t) => mine.has(t.id));
  const myNext = myUpcoming[0] ?? null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: state.event.name }} />
      <ConnectionLine connection={connection} />
      <Text style={styles.title} accessibilityRole="header">
        {state.event.name}
      </Text>

      {state.event.status === "approved" ? (
        <View style={styles.card}>
          <Text style={styles.label}>Starts {shortCountdown(state.event.startAt, now)}</Text>
          <Text style={styles.bigClock}>{formatClock(Date.parse(state.event.startAt) - now)}</Text>
          <Text style={styles.muted}>at {formatTime(state.event.startAt, tz)}</Text>
          {myNext ? (
            <Text style={styles.body}>
              Your first task, {myNext.title}, is planned for {formatTime(new Date(view.expectedAt.get(myNext.id)!).toISOString(), tz)}.
            </Text>
          ) : null}
        </View>
      ) : null}

      {state.event.status === "past" ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>This event has ended</Text>
          <Text style={styles.muted}>
            {state.event.endedEarlyAt ? `It was ended at ${formatTime(state.event.endedEarlyAt, tz)}.` : "Thank you for taking part."}
          </Text>
        </View>
      ) : null}

      {state.event.status === "live" ? (
        <>
          <YourTurn current={view.current} next={view.next} myNext={myNext} mine={mine} expectedAt={view.expectedAt} now={now} tz={tz} />

          {view.current ? (
            <View style={[styles.card, mine.has(view.current.id) && styles.mineCard]}>
              <Text style={[styles.label, { color: colors.live }]}>On now</Text>
              <Text style={styles.taskTitle}>{view.current.title}</Text>
              <People names={view.current.assignees} />
              {view.remainingMs !== null ? (
                <>
                  <Text
                    style={[styles.bigClock, view.remainingMs < 0 && styles.over]}
                    accessibilityLabel={view.remainingMs < 0 ? `Over by ${formatClock(view.remainingMs)}` : `${formatClock(view.remainingMs)} left`}
                  >
                    {view.remainingMs < 0 ? `+${formatClock(view.remainingMs)}` : formatClock(view.remainingMs)}
                  </Text>
                  <Text style={[styles.muted, view.remainingMs < 0 && styles.overText]}>
                    {view.remainingMs < 0 ? "Running over time" : "left"}
                  </Text>
                  <View style={styles.bar} accessibilityElementsHidden>
                    <View style={[styles.barFill, { width: `${Math.round(view.progress * 100)}%` }, view.remainingMs < 0 && styles.barOver]} />
                  </View>
                </>
              ) : null}
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.muted}>Waiting for the organisers to start the next task.</Text>
            </View>
          )}

          {view.next ? (
            <View style={[styles.card, mine.has(view.next.id) && styles.mineCard]}>
              <Text style={styles.label}>Up next</Text>
              <Text style={styles.taskTitle}>{view.next.title}</Text>
              <People names={view.next.assignees} />
              <ExpectedAt at={view.expectedAt.get(view.next.id)!} now={now} tz={tz} />
            </View>
          ) : null}

          {myUpcoming.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Your tasks</Text>
              {myUpcoming.map((t) => (
                <Row key={t.id} task={t} at={view.expectedAt.get(t.id)!} tz={tz} highlight />
              ))}
            </View>
          ) : null}

          {view.upcoming.length > 1 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Then</Text>
              {view.upcoming.slice(1, 5).map((t) => (
                <Row key={t.id} task={t} at={view.expectedAt.get(t.id)!} tz={tz} highlight={mine.has(t.id)} />
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      <Button label="See the full program" variant="link" onPress={() => router.back()} />
    </ScrollView>
  );
}

function ConnectionLine({ connection }: { connection: LiveConnection }) {
  const ok = connection === "connected";
  return (
    <View style={styles.connection} accessibilityLiveRegion="polite">
      <View style={[styles.dot, { backgroundColor: ok ? colors.live : colors.warningText }]} />
      <Text style={[styles.muted, !ok && { color: colors.warningText }]}>
        {ok ? "Live: updates as the organisers move on" : connection === "connecting" ? "Connecting…" : "Connection lost. Reconnecting…"}
      </Text>
    </View>
  );
}

/** The one line a participant most needs: is it me now, or soon? */
function YourTurn(props: {
  current: LiveTask | null;
  next: LiveTask | null;
  myNext: LiveTask | null;
  mine: Set<string>;
  expectedAt: Map<string, number>;
  now: number;
  tz: string;
}) {
  const { current, next, myNext, mine, expectedAt, now, tz } = props;
  let text: string | null = null;
  let tone: "live" | "warning" | "plain" = "plain";
  if (current && mine.has(current.id)) {
    text = "You're on now";
    tone = "live";
  } else if (next && mine.has(next.id)) {
    text = "You're up next. Get ready.";
    tone = "warning";
  } else if (myNext) {
    const at = expectedAt.get(myNext.id)!;
    text = `Your next task, ${myNext.title}, is in about ${formatClock(at - now)} (${formatTime(new Date(at).toISOString(), tz)}).`;
  }
  if (!text) return null;
  return (
    <View
      style={[styles.turn, tone === "live" && styles.turnLive, tone === "warning" && styles.turnWarning]}
      accessibilityRole="alert"
    >
      <Text style={[styles.turnText, tone === "live" && { color: colors.live }, tone === "warning" && { color: colors.warningText }]}>{text}</Text>
    </View>
  );
}

function People({ names }: { names: string[] }) {
  return names.length ? <Text style={styles.people}>{names.join(", ")}</Text> : null;
}

function ExpectedAt({ at, now, tz }: { at: number; now: number; tz: string }) {
  return (
    <Text style={styles.muted}>
      Expected at {formatTime(new Date(at).toISOString(), tz)} · in {formatClock(at - now)}
    </Text>
  );
}

function Row({ task, at, tz, highlight }: { task: LiveTask; at: number; tz: string; highlight: boolean }) {
  return (
    <View style={[styles.row, highlight && styles.mineCard]}>
      <Text style={styles.rowTime}>{formatTime(new Date(at).toISOString(), tz)}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{task.title}</Text>
        <People names={task.assignees} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.xl, paddingBottom: space.xxl * 2, gap: space.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, backgroundColor: colors.background },
  connection: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { color: colors.text, fontSize: 24, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 14 },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: 4 },
  mineCard: { backgroundColor: colors.mineSurface },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  label: { color: colors.muted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  taskTitle: { color: colors.text, fontSize: 22, fontWeight: "700" },
  people: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  bigClock: { color: colors.text, fontSize: 56, fontWeight: "800", fontVariant: ["tabular-nums"], marginTop: space.sm },
  over: { color: colors.danger },
  overText: { color: colors.danger, fontWeight: "600" },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden", marginTop: space.sm },
  barFill: { height: 6, backgroundColor: colors.live },
  barOver: { backgroundColor: colors.danger },
  turn: { borderRadius: radius.lg, padding: space.lg, backgroundColor: colors.surface },
  turnLive: { backgroundColor: colors.liveSurface },
  turnWarning: { backgroundColor: colors.warningSurface },
  turnText: { color: colors.text, fontSize: 17, fontWeight: "700", lineHeight: 23 },
  section: { gap: space.sm, marginTop: space.sm },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  row: { flexDirection: "row", gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surface },
  rowTime: { color: colors.text, fontSize: 15, fontWeight: "700", width: 58, fontVariant: ["tabular-nums"] },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
});

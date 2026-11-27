import { useEffect, useRef, useState } from "react";
import { Alert, Animated, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { ApiError, api } from "../lib/api";
import { font } from "../theme";

export type LiveAction = "start" | "next" | "undo" | "end";
type Run = (action: LiveAction) => Promise<void>;

const KNOB = 50;
const UNDO_SECONDS = 5;

export const runLive = (eventId: string): Run => async (action) => {
  await api(`/events/${encodeURIComponent(eventId)}/live/${action}`, { body: {} });
};

/** What the slider does now, or null when there's nothing to do. */
export function sliderStep(input: {
  status: string;
  startAt: string;
  now: number;
  tasks: { id: string; title: string; status: string }[];
  currentTaskId: string | null;
}): { action: "start" | "next" | "end"; label: string; prefix: string; name: string | null } | null {
  if (input.status === "approved") {
    // Starting early: from an hour before.
    return input.now >= Date.parse(input.startAt) - 60 * 60_000 ? { action: "start", label: "Slide to start now", prefix: "Slide to start now", name: null } : null;
  }
  if (input.status !== "live") return null;
  const next = input.tasks.find((t) => t.status === "upcoming");
  return next
    ? { action: "next", label: `Slide to start ${next.title}`, prefix: "Slide to start", name: next.title }
    : { action: "end", label: "Slide to end the event", prefix: "Slide to end the event", name: null };
}

/**
 * Slide to skip, for Admins and Planners running the event from their phone. Sliding is the
 * confirmation, so skipping and starting happen straight away (with Undo after a skip);
 * ending asks once more, since it can't be undone.
 */
export function SlideControl({
  step,
  online,
  fg,
  bg,
  track,
  run,
  onSkipped,
}: {
  step: NonNullable<ReturnType<typeof sliderStep>>;
  online: boolean;
  /** Pushdown colours: the knob, the icon on it, and the track. */
  fg: string;
  bg: string;
  track: string;
  run: Run;
  /** After a skip, with the item that just started. */
  onSkipped(started: string): void;
}) {
  const x = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  const [busy, setBusy] = useState(false);
  const max = Math.max(0, width - KNOB - 10);
  const live = useRef({ max, busy, online, step, run, onSkipped });
  live.current = { max, busy, online, step, run, onSkipped };

  const back = () => Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();

  async function complete() {
    const { step: s, run: send, onSkipped: skipped } = live.current;
    if (s.action === "end") {
      const ok = await new Promise<boolean>((resolve) =>
        Alert.alert("End the event?", "Anything not done yet is marked skipped, and guest links stop working. This can't be undone.", [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "End event", style: "destructive", onPress: () => resolve(true) },
        ]),
      );
      if (!ok) return back();
    }
    setBusy(true);
    try {
      await send(s.action);
      if (s.action === "next" && s.name) skipped(s.name);
    } catch (err) {
      Alert.alert("That didn't work", err instanceof ApiError ? err.message : "Check your connection and try again.");
    } finally {
      setBusy(false);
      x.setValue(0);
    }
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !live.current.busy && live.current.online,
      onMoveShouldSetPanResponder: () => !live.current.busy && live.current.online,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => x.setValue(Math.max(0, Math.min(live.current.max, g.dx))),
      onPanResponderRelease: (_e, g) => {
        if (live.current.max > 0 && g.dx >= live.current.max * 0.85) {
          Animated.timing(x, { toValue: live.current.max, duration: 90, useNativeDriver: true }).start(() => void complete());
        } else back();
      },
      onPanResponderTerminate: back,
    }),
  ).current;

  // The instruction is plain and dimmed; the item's name is bold, solid and in quotes, so it
  // can't be mistaken for part of the instruction.
  const label = !online ? (
    <Text style={styles.hint}>Connect to run the event</Text>
  ) : busy ? (
    <Text style={styles.hint}>One moment…</Text>
  ) : (
    <>
      <Text style={styles.hint}>{step.prefix}</Text>
      {step.name ? <Text style={styles.name}> “{step.name}”</Text> : null}
    </>
  );
  const fade = max ? x.interpolate({ inputRange: [0, max * 0.6], outputRange: [1, 0], extrapolate: "clamp" }) : 1;

  return (
    <View
      style={[styles.track, { backgroundColor: track }, !online && { opacity: 0.5 }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="button"
      accessibilityLabel={step.label.replace("Slide to ", "")}
      accessibilityHint="Double tap to do this now"
      accessibilityState={{ disabled: !online || busy }}
      accessibilityActions={[{ name: "activate" }]}
      onAccessibilityAction={() => {
        if (online && !busy) void complete();
      }}
    >
      <Animated.Text style={[styles.label, { color: fg, opacity: fade }]} numberOfLines={1}>
        {label}
      </Animated.Text>
      <Animated.View {...pan.panHandlers} style={[styles.knob, { backgroundColor: fg, transform: [{ translateX: x }] }]}>
        {step.action === "end" ? <View style={[styles.stop, { backgroundColor: bg }]} /> : step.action === "start" ? <Play color={bg} /> : <SkipIcon color={bg} />}
      </Animated.View>
      <Text style={[styles.chevron, { color: fg }]}>›</Text>
    </View>
  );
}

/** "Offering started · Undo 5", counting down, then gone. */
export function UndoToast({ title, bottom, onUndo, onDone }: { title: string; bottom: number; onUndo(): Promise<void>; onDone(): void }) {
  const [left, setLeft] = useState(UNDO_SECONDS);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (left <= 0) return onDone();
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left, onDone]);
  return (
    <View style={[styles.toast, { bottom }]} accessibilityLiveRegion="polite">
      <Text style={styles.toastText} numberOfLines={1}>
        <Text style={styles.name}>“{title}”</Text>
        <Text style={styles.hint}> started</Text>
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Undo"
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await onUndo();
            onDone();
          } catch (err) {
            Alert.alert("Couldn't undo", err instanceof ApiError ? err.message : "Check your connection and try again.");
            onDone();
          }
        }}
        style={({ pressed }) => [styles.undo, pressed && { opacity: 0.8 }]}
      >
        <Text style={styles.undoText}>{busy ? "Undoing…" : `Undo · ${left}`}</Text>
      </Pressable>
    </View>
  );
}

function SkipIcon({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginLeft: 3 }}>
      <View style={[styles.tri, { borderLeftColor: color }]} />
      <View style={{ width: 3, height: 16, borderRadius: 1, backgroundColor: color, marginLeft: 1 }} />
    </View>
  );
}
const Play = ({ color }: { color: string }) => <View style={[styles.tri, { borderLeftColor: color, marginLeft: 4 }]} />;

const styles = StyleSheet.create({
  track: { height: 60, borderRadius: 30, justifyContent: "center", marginTop: 6 },
  label: { textAlign: "center", fontSize: 15, paddingHorizontal: 64 },
  hint: { opacity: 0.5, ...font("400") },
  name: { ...font("700") },
  knob: { position: "absolute", left: 5, top: 5, width: KNOB, height: KNOB, borderRadius: KNOB / 2, alignItems: "center", justifyContent: "center" },
  chevron: { position: "absolute", right: 20, fontSize: 24, opacity: 0.5, ...font("400") },
  tri: { width: 0, height: 0, borderTopWidth: 9, borderBottomWidth: 9, borderLeftWidth: 13, borderTopColor: "transparent", borderBottomColor: "transparent" },
  stop: { width: 16, height: 16, borderRadius: 3 },
  toast: { position: "absolute", left: 20, right: 20, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingLeft: 16, paddingRight: 10, borderRadius: 16, backgroundColor: "#f4f5f7", shadowColor: "#000", shadowOpacity: 0.6, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  toastText: { flex: 1, color: "#0b0c10", fontSize: 15, ...font("600") },
  undo: { height: 38, paddingHorizontal: 14, borderRadius: 19, backgroundColor: "#0b0c10", justifyContent: "center" },
  undoText: { color: "#fff", fontSize: 14, ...font("700") },
});

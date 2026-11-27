import { Stack, router } from "expo-router";
import { useKeepAwake } from "expo-keep-awake";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, Vibration, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BroadcastModal, useBroadcasts } from "../broadcasts/BroadcastAlerts";
import { Button } from "../components/Button";
import { ChatIcon } from "../components/TabIcons";
import { TextField } from "../components/TextField";
import { OfflineBanner } from "../components/OfflineBanner";
import { ApiError } from "../lib/api";
import { readCache, writeCache } from "../lib/cache";
import { useOnline } from "../lib/connectivity";
import { sendOrQueue } from "../lib/outbox";
import { formatDuration, formatTime } from "../lib/time";
import { useNow } from "../lib/useNow";
import { SlideControl, UndoToast, runLive, sliderStep } from "./LiveControls";
import { useLiveEvent } from "../live/useLiveEvent";
import { colors, font } from "../theme";
import { ConfettiBurst, Horn, HORN, ROUND_MS, ROUNDS } from "./Celebration";
import { allFace, expectedStarts, faceProgress, followPlan, formatFace, meFace, PART_DONE, type Face, type FaceTask, type Tone } from "./faces";
import type { EventDetail } from "./types";

type Tab = "me" | "all" | "messages";

/** The pushdown's colours. Amber is light, so its text is dark. */
const TONES: Record<Tone, { bg: string; fg: string; sub: string; button: string }> = {
  purple: { bg: "#460976", fg: "#ffffff", sub: "rgba(255,255,255,0.78)", button: "rgba(255,255,255,0.14)" },
  amber: { bg: "#f5b301", fg: "#1c1300", sub: "rgba(28,19,0,0.78)", button: "rgba(0,0,0,0.12)" },
  green: { bg: "#15803d", fg: "#ffffff", sub: "rgba(255,255,255,0.85)", button: "rgba(255,255,255,0.16)" },
  red: { bg: "#c62828", fg: "#ffffff", sub: "rgba(255,255,255,0.85)", button: "rgba(255,255,255,0.16)" },
};
const PILL = "#460a76";
const PILL_ON = "#23093b";
const MINE = "#b98af5";

/**
 * The event screen once it's approved or live. The coloured pushdown at the top holds one big
 * countdown; Me (your part), All (the program as it runs) and Messages sit below it. Everything
 * else (title, venue, times) is left out: in the moment, it's noise.
 */
export function PushdownScreen({
  data,
  onUpdated,
  refresh,
  savedAt,
}: {
  data: EventDetail;
  onUpdated(d: EventDetail): void;
  refresh(): void;
  /** When the saved copy was last confirmed fresh, for the offline banner. */
  savedAt: number | null;
}) {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const eventId = data.event.id;
  const broadcasts = useBroadcasts(eventId);
  const { state: liveState, clockOffset, connection } = useLiveEvent(eventId, (msg) => {
    if (msg.type === "plan-changed") refresh();
    if (msg.type === "broadcast") broadcasts.incoming(msg.broadcast);
  });
  // The live room's last state is saved, so reopening mid-event with no connection still knows what was on.
  const liveKey = `live:${eventId}`;
  const [savedLive] = useState(() => readCache<NonNullable<typeof liveState>>(liveKey)?.value ?? null);
  useEffect(() => {
    if (liveState) writeCache(liveKey, liveState);
  }, [liveState, liveKey]);
  const state = liveState ?? savedLive;
  const online = useOnline();
  const now = useNow(1000) + clockOffset;

  const participant = data.me.participant;
  const declined = participant?.response === "declined";
  const mine = useMemo(
    () => new Set(participant && !declined ? data.tasks.filter((t) => t.assigneeIds.includes(participant.id)).map((t) => t.id) : []),
    [data, participant, declined],
  );
  const names = useMemo(() => new Map(data.participants.map((p) => [p.id, p.name])), [data]);

  // The live room's view of each item (status, when it actually started) over the plan.
  const live = new Map((state?.tasks ?? []).map((t) => [t.id, t]));
  const tasks: FaceTask[] = data.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    // Approved and live programs always have lengths.
    durationMinutes: t.durationMinutes ?? 0,
    plannedStartAt: t.startAt,
    status: live.get(t.id)?.status ?? t.status,
    actualStartAt: live.get(t.id)?.actualStartAt ?? null,
  }));
  const status = state?.event.status ?? data.event.status;
  const heard = {
    status,
    startAt: data.event.startAt,
    tasks,
    currentTaskId: state?.currentTaskId ?? null,
    mine,
    warningMs: (data.team?.liveWarningMinutes ?? 1) * 60_000,
    now,
  };
  // Not connected to the live room: follow the plan from the last thing we heard. Snaps back to
  // the real state as soon as the connection returns.
  const input = connection === "connected" ? heard : followPlan(heard);
  const following = !online && input.status === "live";
  const me = meFace(input);
  // Each item's start as things stand (moves when items start early or run late).
  const starts = expectedStarts(input);
  const all = allFace(input);

  const [tab, setTab] = useState<Tab>(me ? "me" : "all");
  useEffect(() => {
    if (!me && tab === "me") setTab("all");
  }, [me, tab]);
  const face = tab === "me" ? me ?? all : tab === "all" ? all : me ?? all;

  // A light tap when the colour changes: the cue to get ready, or that time is up.
  const lastTone = useRef(face.tone);
  useEffect(() => {
    if (lastTone.current !== face.tone) Vibration.vibrate(60);
    lastTone.current = face.tone;
  }, [face.tone]);

  // Unread: anything not yet answered, or newer than when Messages was last opened.
  const [seenAt, setSeenAt] = useState<string>("");
  const unread = broadcasts.history.some((b) => b.response === "none" || (seenAt && b.sentAt > seenAt));
  const open = (t: Tab) => {
    setTab(t);
    if (t === "messages") setSeenAt(new Date().toISOString());
  };

  // Offline, the change shows straight away and is sent when the connection is back.
  async function respond(response: "acknowledged" | "declined", reason: string | null) {
    const sent = await sendOrQueue<EventDetail>(
      `/events/${encodeURIComponent(eventId)}/response`,
      response === "declined" ? { response, reason } : { response },
      response === "declined" ? "that you can't make it" : "that you can make it",
    );
    onUpdated(sent ?? { ...data, me: { ...data.me, participant: participant && { ...participant, response, declineReason: reason } } });
  }

  const [menu, setMenu] = useState(false);
  const [declining, setDeclining] = useState(false);
  const tone = TONES[face.tone];

  // Your part is done: the confetti horn, three rounds of 7 seconds, then it stops for this visit.
  const celebrate = tab === "me" && !!me && me.caption === PART_DONE;
  const [round, setRound] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);
  useEffect(() => {
    if (!celebrate || reduceMotion || round >= ROUNDS) return;
    const t = setTimeout(() => setRound((r) => r + 1), ROUND_MS);
    return () => clearTimeout(t);
  }, [celebrate, reduceMotion, round]);
  const playing = celebrate && !reduceMotion && round < ROUNDS;
  const [top, setTop] = useState<{ y: number; width: number; height: number } | null>(null);
  const screen = useWindowDimensions();
  // The horn's mouth at rest: it pivots on its tip, HORN.bottom + 2px above the bottom of the pushdown.
  const mouth = top && {
    x: top.width * HORN.across + HORN.mouthAtRest.dx,
    y: top.y + top.height - HORN.bottom - (HORN.height - HORN.tip) + HORN.mouthAtRest.dy,
  };
  const tz = data.event.timezone;

  // Admins and Planners run the event from here: slide to start, skip to the next item, or end.
  const canRun = !!data.permissions.canRunLive;
  const run = useMemo(() => runLive(eventId), [eventId]);
  const step = canRun ? sliderStep({ status: input.status, startAt: data.event.startAt, now, tasks: input.tasks, currentTaskId: input.currentTaskId }) : null;
  const [undoFor, setUndoFor] = useState<string | null>(null);
  const clearUndo = useCallback(() => setUndoFor(null), []);
  function endFromMenu() {
    setMenu(false);
    Alert.alert("End the event?", "Anything not done yet is marked skipped, and guest links stop working. This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "End event",
        style: "destructive",
        onPress: () => void run("end").catch((err) => Alert.alert("Couldn't end the event", err instanceof ApiError ? err.message : "Check your connection and try again.")),
      },
    ]);
  }

  return (
    <View style={[styles.screen, { backgroundColor: tone.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style={face.tone === "amber" ? "dark" : "light"} />

      <View style={{ paddingTop: insets.top }}>
        {/* Offline: a slim strip in a darker shade of the pushdown, so the colour still runs to the top. */}
        <OfflineBanner savedAt={savedAt} following={following} tint="rgba(0,0,0,0.25)" color={tone.fg} />
      </View>
      <View
        style={[styles.top, { paddingTop: 8 }, celebrate && { paddingBottom: 100 }]}
        onLayout={(e) => setTop({ y: e.nativeEvent.layout.y, width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      >
        <View style={styles.topRow}>
          <RoundButton label="Back to events" color={tone.button} onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}>
            <Text style={[styles.glyph, { color: tone.fg }]}>‹</Text>
          </RoundButton>
          {participant || (canRun && input.status === "live") ? (
            <RoundButton label="More" color={tone.button} onPress={() => setMenu(true)}>
              <View style={styles.kebab}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={[styles.kebabDot, { backgroundColor: tone.fg }]} />
                ))}
              </View>
            </RoundButton>
          ) : null}
        </View>
        <Countdown face={face} now={now} fg={tone.fg} sub={tone.sub} />
        {step ? <SlideControl step={step} online={online} fg={tone.fg} bg={tone.bg} track={tone.button} run={run} onSkipped={setUndoFor} /> : null}
        {/* Drawn before the sheet, so the sheet hides its lower half. */}
        {playing ? <Horn key={`horn-${round}`} /> : celebrate && reduceMotion ? <Horn still /> : null}
      </View>

      <View style={styles.sheet}>
        <ScrollView contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + 110 }]}>
          {tab === "me" ? (
            <MeTab starts={starts} tasks={input.tasks} mine={mine} tz={tz} input={input} latest={broadcasts.history[0] ?? null} onOpenMessages={() => open("messages")} />
          ) : tab === "all" ? (
            <AllTab starts={starts} data={data} tasks={input.tasks} mine={mine} names={names} participantId={participant?.id ?? null} tz={tz} current={input.currentTaskId} over={all.over} />
          ) : (
            <MessagesTab items={broadcasts.history} tz={tz} />
          )}
        </ScrollView>
        <Switcher tab={tab} hasMe={!!me} unread={unread && tab !== "messages"} onChange={open} bottom={insets.bottom + 12} />
      </View>

      {playing && mouth ? (
        <ConfettiBurst key={`confetti-${round}`} x={mouth.x} y={mouth.y} room={mouth.y - insets.top - 24} fall={screen.height - mouth.y} />
      ) : null}
      {undoFor ? <UndoToast key={undoFor} title={undoFor} bottom={insets.bottom + 76} onUndo={() => run("undo")} onDone={clearUndo} /> : null}
      <BroadcastModal broadcast={broadcasts.current} waiting={broadcasts.waiting} timezone={tz} onReply={broadcasts.reply} />
      <Menu
        visible={menu}
        top={insets.top + 60}
        declined={declined}
        attending={!!participant}
        onEnd={canRun && input.status === "live" ? endFromMenu : null}
        onClose={() => setMenu(false)}
        onDecline={() => {
          setMenu(false);
          setDeclining(true);
        }}
        onAttend={async () => {
          setMenu(false);
          try {
            await respond("acknowledged", null);
          } catch {
            /* the menu stays available to try again */
          }
        }}
      />
      <DeclineSheet visible={declining} onClose={() => setDeclining(false)} onSend={(reason) => respond("declined", reason).then(() => setDeclining(false))} />
    </View>
  );
}

function RoundButton({ label, color, onPress, children }: { label: string; color: string; onPress(): void; children: React.ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.round, { backgroundColor: color }, pressed && { opacity: 0.7 }]}>
      {children}
    </Pressable>
  );
}

function Countdown({ face, now, fg, sub }: { face: Face; now: number; fg: string; sub: string }) {
  const big = formatFace(face, now);
  const size = big.length <= 5 ? 96 : big.length <= 6 ? 84 : big.length <= 9 ? 56 : 44;
  const left = face.target !== null && !face.over && face.from !== null && !face.estimated;
  return (
    <View style={styles.count} accessible accessibilityLiveRegion="none" accessibilityLabel={`${face.caption}. ${face.estimated ? "About " : ""}${big}${left ? " left" : ""}`}>
      <Text style={[styles.caption, { color: sub }]} numberOfLines={1}>
        {face.caption}
      </Text>
      <View style={styles.bigRow}>
        {face.estimated && face.target !== null ? <Text style={[styles.left, { color: sub, marginLeft: 0, marginRight: 6 }]}>about</Text> : null}
        <Text style={[styles.big, { color: fg, fontSize: size, lineHeight: size * 1.05 }]} numberOfLines={1} adjustsFontSizeToFit>
          {big}
        </Text>
        {left ? <Text style={[styles.left, { color: sub }]}>left</Text> : null}
      </View>
      {face.from !== null && face.target !== null ? (
        <View style={[styles.bar, { backgroundColor: fg === "#ffffff" ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.18)" }]}>
          <View style={[styles.barFill, { backgroundColor: fg, width: `${Math.round(faceProgress(face, now) * 100)}%` }]} />
        </View>
      ) : null}
    </View>
  );
}

function Switcher({ tab, hasMe, unread, onChange, bottom }: { tab: Tab; hasMe: boolean; unread: boolean; onChange(t: Tab): void; bottom: number }) {
  const seg = (key: Tab, label: string, content: React.ReactNode) => {
    const on = tab === key;
    return (
      <Pressable
        key={key}
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected: on }}
        onPress={() => onChange(key)}
        style={[styles.seg, key === "messages" && styles.segIcon, on && { backgroundColor: PILL_ON }]}
      >
        {content}
      </Pressable>
    );
  };
  const text = (key: Tab, label: string) => <Text style={[styles.segText, tab === key && styles.segTextOn]}>{label}</Text>;
  return (
    <View style={[styles.switcherWrap, { bottom }]} pointerEvents="box-none">
      <View style={styles.switcher} accessibilityRole="tablist">
        {hasMe ? seg("me", "Me", text("me", "Me")) : null}
        {hasMe ? <View style={styles.divider} /> : null}
        {seg("all", "All", text("all", "All"))}
        <View style={styles.divider} />
        {seg(
          "messages",
          unread ? "Messages, unread" : "Messages",
          <View>
            <ChatIcon color={tab === "messages" ? "#ffffff" : "rgba(255,255,255,0.78)"} size={22} />
            {unread ? <View style={styles.unread} /> : null}
          </View>,
        )}
      </View>
    </View>
  );
}

type Input = Parameters<typeof meFace>[0];

function MeTab(props: { starts: Map<string, number>; tasks: FaceTask[]; mine: Set<string>; tz: string; input: Input; latest: { body: string; sentBy: string; sentAt: string } | null; onOpenMessages(): void }) {
  const { tasks, mine, tz, input, latest, onOpenMessages } = props;
  const parts = tasks.filter((t) => mine.has(t.id));
  const nextUp = tasks.find((t) => t.status === "upcoming");
  return (
    <View style={styles.stack}>
      <Text style={styles.label}>{parts.length === 1 ? "Your part" : "Your parts"}</Text>
      {parts.map((t) => {
        const done = t.status === "done" || t.status === "skipped";
        const onNow = t.status === "in_progress" && t.id === input.currentTaskId;
        const over = onNow && t.actualStartAt !== null && input.now > Date.parse(t.actualStartAt) + t.durationMinutes * 60_000;
        const tag = over ? ["Over time", "#ffffff", "#c62828"] : onNow ? ["On now", "#04210f", colors.live] : input.status === "live" && nextUp?.id === t.id ? ["Up next", "#2a1d00", "#f5b301"] : null;
        return (
          <View key={t.id} style={[styles.card, onNow && { borderColor: over ? "#6b1f1f" : "#1f5c36" }]}>
            <Text style={[styles.cardTime, done && styles.doneText]}>{formatTime(new Date(props.starts.get(t.id) ?? Date.parse(t.plannedStartAt)).toISOString(), tz)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, done && styles.strike]}>{t.title}</Text>
              <Text style={[styles.muted, done && styles.doneText]}>{formatDuration(t.durationMinutes)}</Text>
            </View>
            {tag ? <Text style={[styles.tag, { color: tag[1], backgroundColor: tag[2] }]}>{tag[0]}</Text> : null}
          </View>
        );
      })}
      {latest ? (
        <Pressable accessibilityRole="button" accessibilityHint="Opens Messages" onPress={onOpenMessages} style={({ pressed }) => [styles.message, { marginTop: 8 }, pressed && { opacity: 0.75 }]}>
          <View style={styles.messageHead}>
            <Text style={[styles.label, { flex: 1 }]}>Latest message</Text>
            <Text style={styles.muted}>{formatTime(latest.sentAt, tz)}</Text>
          </View>
          <Text style={styles.messageBody}>{latest.body}</Text>
          <Text style={styles.muted}>{latest.sentBy}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function AllTab(props: {
  starts: Map<string, number>;
  data: EventDetail;
  tasks: FaceTask[];
  mine: Set<string>;
  names: Map<string, string>;
  participantId: string | null;
  tz: string;
  current: string | null;
  over: boolean;
}) {
  const { data, tasks, mine, names, participantId, tz, current, over } = props;
  if (tasks.length === 0) return <Text style={styles.muted}>The program hasn't been planned yet.</Text>;
  return (
    <View>
      <Text style={[styles.label, { marginBottom: 10 }]}>Program</Text>
      {tasks.map((t, i) => {
        const done = t.status === "done" || t.status === "skipped";
        const isNow = t.id === current && t.status === "in_progress";
        const isMine = mine.has(t.id);
        const people = (data.tasks.find((x) => x.id === t.id)?.assigneeIds ?? []).map((id) => (id === participantId ? "You" : names.get(id) ?? "Someone"));
        const dot = isNow ? (over ? "#c62828" : colors.live) : done ? "#3a3f4c" : isMine ? MINE : "#3a3f4c";
        return (
          <Pressable
            key={t.id}
            accessibilityRole="button"
            accessibilityHint="Opens the item"
            onPress={() => router.push({ pathname: "/events/[id]/tasks/[taskId]", params: { id: data.event.id, taskId: t.id } })}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          >
            <Text style={[styles.rowTime, done && styles.doneText]}>{formatTime(new Date(props.starts.get(t.id) ?? Date.parse(t.plannedStartAt)).toISOString(), tz)}</Text>
            <View style={styles.rail}>
              <View style={[styles.dot, isNow && styles.dotNow, { backgroundColor: dot }]} />
              {i < tasks.length - 1 ? <View style={styles.line} /> : null}
            </View>
            <View style={styles.rowBody}>
              <Text style={[styles.rowTitle, done && styles.strike]}>
                {t.title}
                {isNow ? <Text style={{ color: over ? colors.danger : colors.live, fontSize: 12 }}>{over ? "  Over time" : "  On now"}</Text> : null}
              </Text>
              <Text style={[styles.rowSub, isMine && !done && { color: MINE }, done && styles.doneText, done && styles.strike]}>
                {[people.join(", "), formatDuration(t.durationMinutes)].filter(Boolean).join(" · ")}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function MessagesTab({ items, tz }: { items: { id: string; body: string; sentBy: string; sentAt: string; response: string }[]; tz: string }) {
  if (items.length === 0) {
    return (
      <View style={styles.stack}>
        <Text style={styles.label}>Messages</Text>
        <Text style={styles.muted}>Messages from the planners will show here.</Text>
      </View>
    );
  }
  return (
    <View style={styles.stack}>
      <Text style={styles.label}>Messages</Text>
      {items.map((b) => (
        <View key={b.id} style={styles.message}>
          <View style={styles.messageHead}>
            <Text style={[styles.cardTitle, { flex: 1, fontSize: 14 }]}>{b.sentBy}</Text>
            {b.response === "none" ? <View style={styles.unreadInline} /> : null}
            <Text style={styles.muted}>{formatTime(b.sentAt, tz)}</Text>
          </View>
          <Text style={styles.messageBody}>{b.body}</Text>
        </View>
      ))}
    </View>
  );
}

function Menu(props: { visible: boolean; top: number; declined: boolean; attending: boolean; onEnd: (() => void) | null; onClose(): void; onDecline(): void; onAttend(): void }) {
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <Pressable style={styles.scrim} onPress={props.onClose} accessibilityLabel="Close menu">
        <View style={[styles.menu, { top: props.top }]} accessibilityRole="menu">
          {props.onEnd ? (
            <Pressable accessibilityRole="menuitem" onPress={props.onEnd} style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: "#26272e" }]}>
              <Text style={[styles.menuText, { color: "#ff9b9b" }]}>End the event</Text>
            </Pressable>
          ) : null}
          {props.attending ? (
            <Pressable
            accessibilityRole="menuitem"
            onPress={props.declined ? props.onAttend : props.onDecline}
            style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: "#26272e" }]}
          >
            <Text style={[styles.menuText, !props.declined && { color: "#ff9b9b" }]}>{props.declined ? "I can make it after all" : "I can't make it"}</Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    </Modal>
  );
}

function DeclineSheet({ visible, onClose, onSend }: { visible: boolean; onClose(): void; onSend(reason: string): Promise<void> }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function send() {
    if (reason.trim().length < 3) return setError("Tell the team why you can't take part.");
    setBusy(true);
    setError(undefined);
    try {
      await onSend(reason.trim());
      setReason("");
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.reason ?? err.message) : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetScrim}>
        <View style={styles.declineCard}>
          <Text style={styles.declineTitle}>Can't make it?</Text>
          <Text style={styles.muted}>Let the team know why, so they can find someone else.</Text>
          <TextField label="Reason" value={reason} onChangeText={setReason} multiline error={error} />
          <Button label={busy ? "Sending…" : "Tell the team"} onPress={send} disabled={busy} />
          <Button label="Cancel" variant="link" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { paddingHorizontal: 20, paddingBottom: 48, gap: 14 },
  topRow: { flexDirection: "row", justifyContent: "space-between" },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  glyph: { fontSize: 34, lineHeight: 38, marginTop: -4, marginLeft: -2, ...font("400") },
  kebab: { gap: 3, alignItems: "center" },
  kebabDot: { width: 4, height: 4, borderRadius: 2 },
  count: { alignItems: "center", gap: 6 },
  caption: { fontSize: 15, ...font("600"), textAlign: "center" },
  bigRow: { flexDirection: "row", alignItems: "baseline", maxWidth: "100%" },
  big: { letterSpacing: -3, fontVariant: ["tabular-nums"], ...font("800"), flexShrink: 1 },
  left: { fontSize: 20, marginLeft: 6, ...font("700") },
  bar: { alignSelf: "stretch", height: 5, borderRadius: 3, overflow: "hidden", marginTop: 6, marginHorizontal: 24 },
  barFill: { height: 5 },
  sheet: { flex: 1, marginTop: -28, backgroundColor: "#000000", borderTopLeftRadius: 32, borderTopRightRadius: 32, overflow: "hidden" },
  sheetContent: { padding: 20, paddingTop: 26 },
  stack: { gap: 12 },
  label: { color: colors.muted, fontSize: 12, letterSpacing: 0.9, textTransform: "uppercase", ...font("700") },
  muted: { color: colors.muted, fontSize: 13, ...font("400") },
  card: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: "#23252e" },
  cardTime: { width: 66, color: colors.muted, fontSize: 13, ...font("700") },
  cardTitle: { color: colors.text, fontSize: 16, ...font("700") },
  tag: { fontSize: 12, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, overflow: "hidden", ...font("700") },
  strike: { textDecorationLine: "line-through" },
  doneText: { color: "#6b7180" },
  message: { padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: "#23252e", gap: 6 },
  messageHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  messageBody: { color: colors.text, fontSize: 15, lineHeight: 21, ...font("400") },
  row: { flexDirection: "row", gap: 12, minHeight: 64 },
  rowTime: { width: 62, color: colors.muted, fontSize: 13, paddingTop: 2, ...font("600") },
  rail: { width: 12, alignItems: "center" },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  dotNow: { width: 12, height: 12, borderRadius: 6 },
  line: { flex: 1, width: 2, backgroundColor: "#1f2330", marginTop: 4 },
  rowBody: { flex: 1, paddingBottom: 18 },
  rowTitle: { color: colors.text, fontSize: 16, ...font("700") },
  rowSub: { color: colors.muted, fontSize: 13, marginTop: 3, ...font("400") },
  switcherWrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  switcher: { flexDirection: "row", alignItems: "center", gap: 2, padding: 4, borderRadius: 26, backgroundColor: PILL, shadowColor: "#000", shadowOpacity: 0.6, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  seg: { height: 44, minWidth: 76, paddingHorizontal: 16, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  segIcon: { minWidth: 60 },
  segText: { color: "rgba(255,255,255,0.78)", fontSize: 16, ...font("600") },
  segTextOn: { color: "#ffffff", ...font("700") },
  divider: { width: 1, height: 22, backgroundColor: "#24073a" },
  unread: { position: "absolute", top: -2, right: -4, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.live, borderWidth: 2, borderColor: PILL },
  unreadInline: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.live },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  menu: { position: "absolute", right: 20, minWidth: 230, padding: 6, borderRadius: 18, backgroundColor: "#1b1c22", borderWidth: 1, borderColor: "#2f3240" },
  menuItem: { minHeight: 48, justifyContent: "center", paddingHorizontal: 12, borderRadius: 12 },
  menuText: { color: colors.text, fontSize: 16, ...font("600") },
  sheetScrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  declineCard: { backgroundColor: "#101116", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, gap: 12 },
  declineTitle: { color: colors.text, fontSize: 20, ...font("800") },
});

import { Stack, router } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type TextInputInstance,
  type PanResponderGestureState,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OfflineBanner } from "../components/OfflineBanner";
import type { EventDetail } from "../events/types";
import { ApiError, api } from "../lib/api";
import { removeCache } from "../lib/cache";
import { useOnline } from "../lib/connectivity";
import { formatDuration, formatTime, toZoned } from "../lib/time";
import { useLiveEvent, type Editor } from "../live/useLiveEvent";
import { colors, font } from "../theme";
import { DetailsSheet } from "./DetailsSheet";
import { ItemSheet, whoBody, type ItemChanges } from "./ItemSheet";
import { useTeamPeople } from "./people";
import { SendSheet } from "./SendSheet";

type Task = EventDetail["tasks"][number];
const ROW = 58;
/** Colours for other editors' markers, picked by name so each person keeps theirs. */
const EDITOR_COLORS = ["#0e7490", "#b45309", "#7c3aed", "#be185d", "#15803d"];
const colorFor = (userId: string) => EDITOR_COLORS[[...userId].reduce((n, c) => n + c.charCodeAt(0), 0) % EDITOR_COLORS.length]!;

/**
 * Building a program on a phone (O1, the quick-add list). Type a title and press return: it's
 * added and the next line is ready (paste a list, and each line becomes an item). Missing
 * lengths and people show as dashed "+ length" / "+ who"; tap an item to fill them in. Drag
 * the grip to reorder. Other Admins and Planners editing the same draft show up live, with a
 * marker on the item they have open. Editing needs a connection; the draft stays readable offline.
 */
export function DraftEditor({ data, onUpdated, refresh, savedAt }: { data: EventDetail; onUpdated(d: EventDetail): void; refresh(): void; savedAt: number | null }) {
  const insets = useSafeAreaInsets();
  const online = useOnline();
  const eventId = data.event.id;
  const path = `/events/${encodeURIComponent(eventId)}`;
  const { people, addGuest } = useTeamPeople(data.event.teamId);

  // Editing together: everyone's changes show up straight away, with who has which item open.
  const [editors, setEditors] = useState<Editor[]>([]);
  const { sendEditing } = useLiveEvent(eventId, (msg) => {
    if (msg.type === "plan-changed") refresh();
    if (msg.type === "presence") setEditors(msg.editors);
  });
  const others = editors.filter((e) => e.userId !== data.me.userId);

  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = (id: string | null) => {
    setOpenId(id);
    sendEditing(id);
  };

  /** Runs a change and shows the updated program (or what went wrong). */
  const change = useCallback(
    async (run: () => Promise<EventDetail>) => {
      setError(null);
      try {
        onUpdated(await run());
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "That didn't save. Check your connection and try again.");
        throw err;
      }
    },
    [onUpdated],
  );

  // ── Quick add ──
  const [draft, setDraft] = useState("");
  const input = useRef<TextInputInstance>(null);
  async function addTitles(titles: string[]) {
    for (const title of titles.map((t) => t.trim()).filter(Boolean)) {
      await change(() => api<EventDetail>(`${path}/tasks`, { body: { title: title.slice(0, 120) } }));
    }
  }
  const onDraftChange = (text: string) => {
    // A pasted list: each line becomes an item.
    if (text.includes("\n")) {
      setDraft("");
      void addTitles(text.split(/\r?\n/)).catch(() => undefined);
    } else setDraft(text);
  };

  // ── Reorder (drag the grip) ──
  const tasks = data.tasks;
  const [order, setOrder] = useState<string[] | null>(null);
  const shown = useMemo(() => (order ? order.map((id) => tasks.find((t) => t.id === id)).filter((t): t is Task => !!t) : tasks), [order, tasks]);
  const [drag, setDrag] = useState<{ from: number; dy: number } | null>(null);
  const target = drag ? Math.max(0, Math.min(shown.length - 1, drag.from + Math.round(drag.dy / ROW))) : null;
  const dropRef = useRef<(from: number, to: number) => void>(() => undefined);
  dropRef.current = (from, to) => {
    if (from === to) return;
    const ids = shown.map((t) => t.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved!);
    setOrder(ids);
    change(() => api<EventDetail>(`${path}/tasks/order`, { method: "PUT", body: { taskIds: ids } }))
      .catch(() => undefined)
      .finally(() => setOrder(null));
  };
  const grip = (index: number) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => online,
      onMoveShouldSetPanResponder: () => online,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => setDrag({ from: index, dy: 0 }),
      onPanResponderMove: (_e: GestureResponderEvent, g: PanResponderGestureState) => setDrag({ from: index, dy: g.dy }),
      onPanResponderRelease: (_e, g) => {
        const to = Math.max(0, Math.min(shown.length - 1, index + Math.round(g.dy / ROW)));
        setDrag(null);
        dropRef.current(index, to);
      },
      onPanResponderTerminate: () => setDrag(null),
    });

  // ── Saving an item from its sheet ──
  const openTask = tasks.find((t) => t.id === openId) ?? null;
  async function saveItem(c: ItemChanges) {
    if (!openTask) return;
    await change(() =>
      api<EventDetail>(`${path}/tasks/${encodeURIComponent(openTask.id)}`, {
        method: "PATCH",
        body: { title: c.title, durationMinutes: c.durationMinutes, stageId: c.stageId, ...whoBody(c.who) },
      }),
    );
  }

  // ── What's still missing, and sending ──
  const missing = tasks.filter((t) => t.durationMinutes === null || t.assigneeIds.length === 0).length;
  const canSend = data.permissions.canSubmit || data.permissions.canPublish;
  const status =
    tasks.length === 0
      ? "Add the first item to get started."
      : missing
        ? `${missing === 1 ? "1 item needs" : `${missing} items need`} a length or someone to run it`
        : data.team?.requireApproval
          ? "Ready to send for approval"
          : "Ready to publish";
  const ready = canSend && tasks.length > 0 && missing === 0 && online;
  async function publish() {
    Alert.alert("Publish this program?", "Everyone on it is told by email and in the app.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Publish",
        onPress: () => void change(async () => (await api(`${path}/publish`, { body: {} }), api<EventDetail>(path))).catch(() => undefined),
      },
    ]);
  }

  const names = new Map(data.participants.map((p) => [p.id, p.name]));
  const when = toZoned(data.event.startAt, data.event.timezone);
  const dateLine = `${new Date(`${when.day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} · ${formatTime(data.event.startAt, data.event.timezone)}`;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ paddingTop: insets.top }}>
        <OfflineBanner savedAt={savedAt} />
      </View>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} style={styles.round}>
          <Text style={styles.glyph}>‹</Text>
        </Pressable>
        <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => setDetails(true)} accessibilityRole="button" accessibilityHint="Edit the name, date and start time">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={styles.name} numberOfLines={1}>
              {data.event.name}
            </Text>
            <Text style={styles.pill}>Draft</Text>
          </View>
          <Text style={styles.when} numberOfLines={1}>
            {dateLine}
            {data.team?.name ? ` · ${data.team.name}` : ""}
          </Text>
        </Pressable>
        {others.length ? (
          <View style={styles.avatars} accessible accessibilityLabel={`${others.map((o) => o.name).join(" and ")} ${others.length === 1 ? "is" : "are"} also editing`}>
            {others.slice(0, 3).map((o) => (
              <View key={o.userId} style={[styles.avatar, { backgroundColor: colorFor(o.userId) }]}>
                <Text style={styles.avatarText}>{initials(o.name)}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Program details" onPress={() => setDetails(true)} style={styles.round}>
          <Text style={[styles.glyph, { fontSize: 20, marginTop: -8 }]}>…</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView scrollEnabled={!drag} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          {shown.map((t, i) => {
            const editor = others.find((o) => o.taskId === t.id);
            let shift = 0;
            if (drag && target !== null && i !== drag.from) {
              if (drag.from < target && i > drag.from && i <= target) shift = -ROW;
              if (drag.from > target && i < drag.from && i >= target) shift = ROW;
            }
            const dragging = drag?.from === i;
            const meta = [t.durationMinutes !== null ? formatDuration(t.durationMinutes) : null, t.assigneeIds.map((id) => names.get(id) ?? "Someone").join(", ") || null].filter(Boolean).join(" · ");
            return (
              <View
                key={t.id}
                style={[
                  styles.row,
                  { transform: [{ translateY: dragging ? drag!.dy : shift }] },
                  dragging && styles.rowDragging,
                  editor && { borderColor: colorFor(editor.userId), borderWidth: 1.5, borderRadius: 12 },
                ]}
              >
                {editor ? (
                  <Text style={[styles.editing, { backgroundColor: colorFor(editor.userId) }]}>{editor.name.split(" ")[0]} is editing</Text>
                ) : null}
                <View {...grip(i).panHandlers} style={styles.grip} accessible accessibilityRole="adjustable" accessibilityLabel={`Move ${t.title}`}>
                  <Text style={styles.gripText}>⋮⋮</Text>
                </View>
                <Pressable style={styles.rowMain} onPress={() => online && open(t.id)} accessibilityRole="button" accessibilityHint="Set its length and who runs it">
                  <Text style={styles.title} numberOfLines={1}>
                    {t.title}
                  </Text>
                  <View style={styles.metaWrap}>
                    {meta ? (
                      <Text style={styles.meta} numberOfLines={1}>
                        {meta}
                      </Text>
                    ) : null}
                    {t.durationMinutes === null ? <Text style={styles.missing}>+ length</Text> : null}
                    {t.assigneeIds.length === 0 ? <Text style={styles.missing}>+ who</Text> : null}
                  </View>
                </Pressable>
              </View>
            );
          })}

          <View style={[styles.add, !online && { opacity: 0.5 }]}>
            <Text style={styles.plus}>+</Text>
            <TextInput
              ref={input}
              value={draft}
              onChangeText={onDraftChange}
              editable={online}
              placeholder={online ? "Add an item" : "Connect to add items"}
              placeholderTextColor="#6b7180"
              selectionColor={colors.accent}
              style={styles.addInput}
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => {
                const title = draft;
                setDraft("");
                void addTitles([title]).catch(() => undefined);
                input.current?.focus();
              }}
              accessibilityLabel="Add an item"
              maxLength={120}
            />
            {draft ? null : <Text style={styles.addHint}>return adds the next</Text>}
          </View>
          <Text style={styles.tip}>Tip: paste a list, and each line becomes an item.</Text>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Text style={styles.status}>{status}</Text>
          {canSend ? (
            <Pressable
              onPress={() => (data.permissions.canSubmit ? setSending(true) : void publish())}
              disabled={!ready}
              accessibilityRole="button"
              accessibilityState={{ disabled: !ready }}
              style={({ pressed }) => [styles.send, !ready && styles.sendOff, pressed && ready && { opacity: 0.85 }]}
            >
              <Text style={[styles.sendText, !ready && { color: "#8d7bb0" }]}>{data.permissions.canSubmit ? "Send for approval" : "Publish"}</Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>

      <ItemSheet
        detail={data}
        task={openTask}
        people={people}
        alsoEditing={others.find((o) => o.taskId === openId)?.name.split(" ")[0] ?? null}
        onAddGuest={addGuest}
        onSave={saveItem}
        onDelete={() => change(() => api<EventDetail>(`${path}/tasks/${encodeURIComponent(openId!)}`, { method: "DELETE" }))}
        onClose={() => open(null)}
      />
      <DetailsSheet
        visible={details}
        data={data}
        onClose={() => setDetails(false)}
        onSave={(body) => change(() => api<EventDetail>(path, { method: "PATCH", body }))}
        onDelete={async () => {
          await api(path, { method: "DELETE" });
          for (const key of [`event:${eventId}`, `broadcasts:${eventId}`, `live:${eventId}`]) removeCache(key);
          setDetails(false);
          if (router.canGoBack()) router.back();
          else router.replace("/");
        }}
      />
      <SendSheet
        visible={sending}
        data={data}
        onClose={() => setSending(false)}
        onSend={(approverIds) => change(async () => (await api(`${path}/submit`, { body: { approverIds } }), api<EventDetail>(path))).then(() => setSending(false))}
      />
    </View>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  round: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: "#0b0c10", alignItems: "center", justifyContent: "center" },
  glyph: { color: colors.text, fontSize: 30, lineHeight: 34, marginTop: -3, ...font("400") },
  name: { color: colors.text, fontSize: 17, flexShrink: 1, ...font("700") },
  pill: { color: colors.muted, backgroundColor: colors.border, fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: "hidden", ...font("700") },
  when: { color: colors.muted, fontSize: 12, marginTop: 2, ...font("400") },
  avatars: { flexDirection: "row", paddingLeft: 6 },
  avatar: { width: 28, height: 28, borderRadius: 14, marginLeft: -6, borderWidth: 2, borderColor: "#000", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 10, ...font("700") },
  error: { color: colors.danger, fontSize: 14, marginBottom: 8, ...font("500") },
  row: { height: ROW, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1c1d24", backgroundColor: "#000" },
  rowDragging: { zIndex: 2, backgroundColor: "#16171d", borderRadius: 12, shadowColor: "#000", shadowOpacity: 0.6, shadowRadius: 12, elevation: 6 },
  editing: { position: "absolute", top: -9, right: 12, zIndex: 3, color: "#fff", fontSize: 10, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 8, overflow: "hidden", ...font("700") },
  grip: { width: 40, height: ROW, alignItems: "center", justifyContent: "center" },
  gripText: { color: "#4a4f5c", fontSize: 16, letterSpacing: -2, ...font("700") },
  rowMain: { flex: 1, minWidth: 0, height: ROW, flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 8 },
  title: { flex: 1, color: colors.text, fontSize: 16, ...font("600") },
  metaWrap: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "58%" },
  meta: { color: colors.muted, fontSize: 13, flexShrink: 1, ...font("400") },
  missing: { color: "#c48cff", fontSize: 12, borderWidth: 1.5, borderStyle: "dashed", borderColor: "#4a3a6b", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1, ...font("600") },
  add: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, height: 52, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  plus: { color: "#c48cff", fontSize: 22, ...font("600") },
  addInput: { flex: 1, color: colors.text, fontSize: 16, height: 52, ...font("500") },
  addHint: { color: colors.muted, fontSize: 12, ...font("400") },
  tip: { color: "#6b7180", fontSize: 12, marginTop: 8, marginLeft: 4, ...font("400") },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1c1d24", backgroundColor: "#000", gap: 8 },
  status: { color: colors.muted, fontSize: 12, textAlign: "center", ...font("500") },
  send: { height: 50, borderRadius: 25, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  sendOff: { backgroundColor: "#2a1d40" },
  sendText: { color: "#fff", fontSize: 16, ...font("700") },
});

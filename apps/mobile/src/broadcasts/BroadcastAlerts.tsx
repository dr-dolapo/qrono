import { useCallback, useEffect, useState } from "react";
import { Modal, StyleSheet, Text, Vibration, View } from "react-native";
import { Button } from "../components/Button";
import { ApiError } from "../lib/api";
import { formatTime } from "../lib/time";
import { colors, font, radius, space } from "../theme";
import { loadMyBroadcasts, replyToBroadcast, type BroadcastReply, type IncomingBroadcast, type MyBroadcast } from "./api";

/**
 * In-app broadcast alerts (QR040) with Acknowledge / Snooze / Done (QR041),
 * plus the list of messages so far. Works in Expo Go too, over the live
 * connection: `incoming` is fed by the live screen's WebSocket.
 */
export function useBroadcasts(eventId: string) {
  const [queue, setQueue] = useState<IncomingBroadcast[]>([]);
  const [history, setHistory] = useState<MyBroadcast[]>([]);

  const reload = useCallback(async () => {
    try {
      const list = await loadMyBroadcasts(eventId);
      setHistory(list);
      // Anything still waiting for a reply (e.g. it arrived while the app was closed).
      setQueue((q) => {
        const pending = list.filter((b) => b.response === "none" && !q.some((x) => x.id === b.id));
        return [...q, ...pending.map((b) => ({ id: b.id, body: b.body, sentBy: b.sentBy, sentAt: b.sentAt, realert: false }))];
      });
    } catch {
      /* the live view still works without the history */
    }
  }, [eventId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const incoming = useCallback((b: IncomingBroadcast) => {
    Vibration.vibrate([0, 400, 200, 400]);
    setQueue((q) => [...q.filter((x) => x.id !== b.id), b]);
    void reload();
  }, [reload]);

  const reply = useCallback(
    async (broadcastId: string, response: BroadcastReply) => {
      await replyToBroadcast(eventId, broadcastId, response);
      setQueue((q) => q.filter((x) => x.id !== broadcastId));
      void reload();
    },
    [eventId, reload],
  );

  return { current: queue[0] ?? null, waiting: queue.length, history, incoming, reply };
}

export function BroadcastModal(props: {
  broadcast: IncomingBroadcast | null;
  waiting: number;
  timezone: string;
  onReply(id: string, response: BroadcastReply): Promise<void>;
}) {
  const { broadcast, waiting, timezone, onReply } = props;
  const [busy, setBusy] = useState<BroadcastReply | null>(null);
  const [error, setError] = useState<string>();

  async function send(response: BroadcastReply) {
    if (!broadcast) return;
    setBusy(response);
    setError(undefined);
    try {
      await onReply(broadcast.id, response);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send your reply. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal visible={!!broadcast} transparent animationType="fade" onRequestClose={() => undefined}>
      <View style={styles.backdrop}>
        {broadcast ? (
          <View style={styles.card} accessibilityViewIsModal accessibilityRole="alert">
            <Text style={styles.label}>{broadcast.realert ? "Reminder from the organisers" : "Message from the organisers"}</Text>
            <Text style={styles.body}>{broadcast.body}</Text>
            <Text style={styles.meta}>
              {broadcast.sentBy} · {formatTime(broadcast.sentAt, timezone)}
              {waiting > 1 ? ` · ${waiting - 1} more waiting` : ""}
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              <Button label="Acknowledge" onPress={() => send("acknowledged")} busy={busy === "acknowledged"} disabled={busy !== null} />
              <Button label="Done" variant="secondary" onPress={() => send("done")} busy={busy === "done"} disabled={busy !== null} />
              <Button
                label="Snooze 3 min"
                variant="secondary"
                onPress={() => send("snoozed")}
                busy={busy === "snoozed"}
                disabled={busy !== null}
                accessibilityHint="The message comes back in 3 minutes"
              />
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const REPLY_LABEL: Record<MyBroadcast["response"], string> = {
  none: "Waiting for your reply",
  acknowledged: "You acknowledged",
  snoozed: "Snoozed",
  done: "You marked it done",
};

export function BroadcastHistory({ items, timezone }: { items: MyBroadcast[]; timezone: string }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.history}>
      <Text style={styles.historyTitle}>Messages from the organisers</Text>
      {items.map((b) => (
        <View key={b.id} style={styles.historyItem}>
          <Text style={styles.historyBody}>{b.body}</Text>
          <Text style={styles.meta}>
            {b.sentBy} · {formatTime(b.sentAt, timezone)} ·{" "}
            <Text style={b.response === "none" ? styles.waiting : undefined}>
              {b.response === "snoozed" && b.snoozeUntil ? `Snoozed until ${formatTime(b.snoozeUntil, timezone)}` : REPLY_LABEL[b.response]}
            </Text>
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: space.xl },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.xl, gap: space.sm, borderWidth: 1, borderColor: colors.accent },
  label: { color: colors.accent, fontSize: 13, ...font("700"), textTransform: "uppercase", letterSpacing: 0.6 },
  body: { color: colors.text, fontSize: 22, ...font("700"), lineHeight: 29 },
  meta: { color: colors.muted, fontSize: 13 , ...font("400")},
  error: { color: colors.danger, fontSize: 14 , ...font("400")},
  actions: { gap: space.sm, marginTop: space.md },
  history: { gap: space.sm, marginTop: space.md },
  historyTitle: { color: colors.text, fontSize: 18, ...font("700") },
  historyItem: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: 4 },
  historyBody: { color: colors.text, fontSize: 15, ...font("400"), lineHeight: 21 },
  waiting: { color: colors.warningText, ...font("600") },
});

import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { Button } from "../../../../components/Button";
import { Screen } from "../../../../components/Screen";
import { TextField } from "../../../../components/TextField";
import type { EventDetail } from "../../../../events/types";
import { ApiError, api } from "../../../../lib/api";
import { formatDate, formatDuration, formatTime } from "../../../../lib/time";
import { useApi } from "../../../../lib/useApi";
import { colors, radius, space } from "../../../../theme";

/** One task with its comments (QR013, QR026, QR031). Comments are private to the event's team and participants. */
export default function TaskScreen() {
  const { id, taskId } = useLocalSearchParams<{ id: string; taskId: string }>();
  const path = `/events/${encodeURIComponent(id)}`;
  const { data, error, loading, refresh, setData } = useApi<EventDetail>(path);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string>();
  const [sending, setSending] = useState(false);

  const task = data?.tasks.find((t) => t.id === taskId);
  const comments = useMemo(() => (data?.comments ?? []).filter((c) => c.taskId === taskId), [data, taskId]);
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

  async function send() {
    const body = draft.trim();
    if (!body) {
      setSendError("Write a comment.");
      return;
    }
    setSending(true);
    setSendError(undefined);
    try {
      setData(await api<EventDetail>(`${path}/tasks/${encodeURIComponent(taskId)}/comments`, { body: { body } }));
      setDraft("");
    } catch (err) {
      setSendError(err instanceof ApiError ? (err.fields.body ?? err.message) : "Couldn't post your comment. Please try again.");
    } finally {
      setSending(false);
    }
  }

  function confirmDelete(commentId: string) {
    Alert.alert("Delete your comment?", "Others will no longer see it.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            setData(await api<EventDetail>(`${path}/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" }));
          } catch (err) {
            Alert.alert("Couldn't delete the comment", err instanceof ApiError ? err.message : "Please try again.");
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: task.title }} />
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {task.title}
        </Text>
        <Text style={styles.when}>
          {formatTime(task.startAt, tz)} – {formatTime(task.endAt, tz)} · {formatDuration(task.durationMinutes)}
        </Text>
        <Text style={styles.muted}>
          {data.event.name} · {formatDate(task.startAt, tz)}
        </Text>
        {people.length ? <Text style={styles.people}>{people.join(", ")}</Text> : <Text style={styles.muted}>Nobody assigned yet</Text>}
        {task.description ? <Text style={styles.description}>{task.description}</Text> : null}
      </View>

      <Text style={styles.heading}>Comments</Text>
      <Text style={styles.muted}>Only the organisers and people on this event can see these. They're never shown on the stage screen.</Text>

      {comments.length === 0 ? <Text style={styles.empty}>No comments yet.</Text> : null}
      {comments.map((cm) => {
        const mine = cm.author.id === data.me.userId;
        return (
          <View key={cm.id} style={[styles.comment, mine && styles.commentMine]}>
            <View style={styles.commentTop}>
              <Text style={styles.author}>{mine ? "You" : cm.author.name}</Text>
              <Text style={styles.stamp}>
                {formatDate(cm.createdAt, tz)} {formatTime(cm.createdAt, tz)}
              </Text>
            </View>
            <Text style={styles.body}>{cm.body}</Text>
            {mine ? <Button label="Delete" variant="link" onPress={() => confirmDelete(cm.id)} /> : null}
          </View>
        );
      })}

      {data.permissions.canComment ? (
        <View style={styles.composer}>
          <TextField
            label="Add a comment"
            value={draft}
            onChangeText={setDraft}
            error={sendError}
            multiline
            maxLength={2000}
            placeholder="e.g. Can we swap the mic before this one?"
            style={styles.input}
          />
          <Button label="Post comment" onPress={send} busy={sending} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  header: { gap: 6, marginBottom: space.sm },
  title: { color: colors.text, fontSize: 24, fontWeight: "800" },
  when: { color: colors.text, fontSize: 16, fontVariant: ["tabular-nums"] },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  people: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  description: { color: colors.text, fontSize: 15, lineHeight: 22, marginTop: space.xs },
  heading: { color: colors.text, fontSize: 20, fontWeight: "700", marginTop: space.md },
  empty: { color: colors.muted, fontSize: 15 },
  comment: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: 4 },
  commentMine: { backgroundColor: colors.mineSurface },
  commentTop: { flexDirection: "row", justifyContent: "space-between", gap: space.sm },
  author: { color: colors.text, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  stamp: { color: colors.muted, fontSize: 12 },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  composer: { gap: space.sm, marginTop: space.md },
  input: { minHeight: 88, textAlignVertical: "top" },
});

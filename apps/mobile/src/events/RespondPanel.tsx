import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { ApiError, api } from "../lib/api";
import { colors, radius, space } from "../theme";
import type { EventDetail } from "./types";

type Mode = "view" | "choose" | "declining";

/** QR033–QR035: confirm my part in an approved event, or decline it with a reason. */
export function RespondPanel({ data, myTaskCount, onUpdated }: { data: EventDetail; myTaskCount: number; onUpdated(d: EventDetail): void }) {
  const participant = data.me.participant;
  const [mode, setMode] = useState<Mode>("view");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<"acknowledged" | "declined" | null>(null);

  if (!participant) return null;
  const { response } = participant;
  const choosing = data.permissions.canRespond && (mode !== "view" || response === "pending");

  async function send(next: "acknowledged" | "declined") {
    if (next === "declined" && reason.trim().length < 3) {
      setError("Tell the team why you can't take part.");
      return;
    }
    setBusy(next);
    setError(undefined);
    try {
      const detail = await api<EventDetail>(`/events/${encodeURIComponent(data.event.id)}/response`, {
        body: next === "declined" ? { response: next, reason: reason.trim() } : { response: next },
      });
      onUpdated(detail);
      setMode("view");
      setReason("");
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.reason ?? err.message) : "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const tasks =
    myTaskCount === 0 ? "No tasks are assigned to you yet." : `You have ${myTaskCount} ${myTaskCount === 1 ? "task" : "tasks"} in this event.`;

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Your part</Text>
      <Text style={styles.body}>{tasks}</Text>

      {!data.permissions.canRespond ? (
        data.event.status === "draft" || data.event.status === "review" ? (
          <Text style={styles.muted}>You'll be asked to confirm once the event is approved.</Text>
        ) : response !== "pending" ? (
          <Text style={styles.body}>{response === "acknowledged" ? "You confirmed you took part." : "You said you couldn't take part."}</Text>
        ) : null
      ) : mode === "declining" ? (
        <View style={styles.form}>
          <TextField
            label="Why can't you take part?"
            value={reason}
            onChangeText={setReason}
            error={error}
            multiline
            maxLength={500}
            placeholder="e.g. I'm travelling that week"
            style={styles.reasonInput}
            autoFocus
          />
          <Button label="Send" onPress={() => send("declined")} busy={busy === "declined"} />
          <Button label="Cancel" variant="link" onPress={() => { setMode(response === "pending" ? "view" : "choose"); setError(undefined); }} />
        </View>
      ) : choosing ? (
        <View style={styles.form}>
          <Text style={[styles.body, response === "pending" && styles.attention]}>
            {response === "pending" ? "The organisers are waiting for you. Can you take part?" : "Change your answer:"}
          </Text>
          <Button label="Yes, I'll be there" onPress={() => send("acknowledged")} busy={busy === "acknowledged"} disabled={busy !== null} />
          <Button label="I can't take part" variant="secondary" onPress={() => setMode("declining")} disabled={busy !== null} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {response !== "pending" ? <Button label="Keep my answer" variant="link" onPress={() => setMode("view")} /> : null}
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.body}>
            {response === "acknowledged" ? "You've confirmed you're taking part." : "You said you can't take part."}
          </Text>
          {response === "declined" && participant.declineReason ? (
            <Text style={styles.muted}>Your reason: {participant.declineReason}</Text>
          ) : null}
          <Button label="Change my answer" variant="link" onPress={() => setMode("choose")} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: 6 },
  title: { color: colors.text, fontSize: 16, fontWeight: "700" },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  attention: { color: colors.warningText, fontWeight: "600" },
  error: { color: colors.danger, fontSize: 13 },
  form: { gap: space.sm, marginTop: space.xs },
  reasonInput: { minHeight: 88, textAlignVertical: "top" },
});

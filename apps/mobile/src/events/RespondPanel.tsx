import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { ApiError, api } from "../lib/api";
import { colors, font, radius, space } from "../theme";
import type { EventDetail } from "./types";

/**
 * QR033–QR035: my part. People on a program are attending by default; they can say they can't
 * make it (with a reason for the team), and change their mind.
 */
export function RespondPanel({ data, myTaskCount, onUpdated }: { data: EventDetail; myTaskCount: number; onUpdated(d: EventDetail): void }) {
  const participant = data.me.participant;
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<"acknowledged" | "declined" | null>(null);

  if (!participant) return null;
  const declined = participant.response === "declined";

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
      setDeclining(false);
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
        data.event.status === "past" ? (
          <Text style={styles.muted}>{declined ? "You said you couldn't take part." : "You were on the program."}</Text>
        ) : null
      ) : declining ? (
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
          <Button label="Send to the team" onPress={() => send("declined")} busy={busy === "declined"} />
          <Button label="Cancel" variant="link" onPress={() => { setDeclining(false); setError(undefined); }} />
        </View>
      ) : declined ? (
        <View style={styles.form}>
          <Text style={styles.body}>You've told the team you can't take part.</Text>
          {participant.declineReason ? <Text style={styles.muted}>Your reason: {participant.declineReason}</Text> : null}
          <Button label="I can make it after all" variant="secondary" onPress={() => send("acknowledged")} busy={busy === "acknowledged"} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.body}>You're down as attending.</Text>
          <Button label="I can't make it" variant="link" onPress={() => setDeclining(true)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: 6 },
  title: { color: colors.text, fontSize: 16, ...font("700") },
  body: { color: colors.text, fontSize: 15, ...font("400"), lineHeight: 21 },
  muted: { color: colors.muted, fontSize: 14, ...font("400"), lineHeight: 20 },
  error: { color: colors.danger, fontSize: 13, ...font("400") },
  form: { gap: space.sm, marginTop: space.xs },
  reasonInput: { minHeight: 88, textAlignVertical: "top" },
});

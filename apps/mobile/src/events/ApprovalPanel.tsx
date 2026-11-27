import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { Button } from "../components/Button";
import { ApiError, api } from "../lib/api";
import { colors, font, radius, space } from "../theme";
import type { EventDetail } from "./types";

/**
 * QR012–QR016 on the go: an Admin chosen for this event reviews the program
 * (the tasks are below) and approves it. "Any to sign": one is enough.
 */
export function ApprovalPanel({ data, onApproved }: { data: EventDetail; onApproved(d: EventDetail): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [justApproved, setJustApproved] = useState(false);

  if (justApproved && data.event.status === "approved") {
    return (
      <View style={[styles.panel, styles.done]} accessibilityLiveRegion="polite">
        <Text style={[styles.title, { color: colors.live }]}>Approved</Text>
        <Text style={styles.body}>Everyone on the program is being emailed their part, and guests get their personal link.</Text>
      </View>
    );
  }
  if (!data.permissions.canApprove) return null;

  const people = data.participants.length;
  const guests = data.participants.filter((p) => p.kind === "guest").length;
  const unassigned = data.tasks.filter((t) => t.assigneeIds.length === 0).length;
  const others = data.approvers.filter((a) => a.userId !== data.me.userId).map((a) => a.name);

  async function approve() {
    setBusy(true);
    setError(undefined);
    try {
      const detail = await api<EventDetail>(`/events/${encodeURIComponent(data.event.id)}/approve`, { method: "POST" });
      setJustApproved(true);
      onApproved(detail);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't approve the event. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    Alert.alert(
      `Approve ${data.event.name}?`,
      "Everyone on the program is emailed their part, and guests get their personal link. Planners can still change the plan afterwards.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Approve", onPress: () => void approve() },
      ],
    );
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Waiting for your approval</Text>
      <Text style={styles.body}>
        {data.tasks.length} {data.tasks.length === 1 ? "task" : "tasks"} · {people} {people === 1 ? "person" : "people"}
        {guests ? ` (${guests} ${guests === 1 ? "guest" : "guests"})` : ""}
      </Text>
      {unassigned > 0 ? (
        <Text style={styles.warning}>
          {unassigned} {unassigned === 1 ? "task has" : "tasks have"} nobody assigned.
        </Text>
      ) : null}
      <Text style={styles.muted}>
        Check the program below.
        {others.length ? ` Also asked to approve: ${others.join(", ")}. One approval is enough.` : ""}
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="Approve event" onPress={confirm} busy={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: space.md, backgroundColor: colors.warningSurface, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  done: { backgroundColor: colors.liveSurface },
  title: { color: colors.warningText, fontSize: 17, ...font("700") },
  body: { color: colors.text, fontSize: 15, ...font("400"), lineHeight: 21 },
  muted: { color: colors.muted, fontSize: 14, ...font("400"), lineHeight: 20 },
  warning: { color: colors.warningText, fontSize: 14, ...font("600") },
  error: { color: colors.danger, fontSize: 14 , ...font("400")},
});

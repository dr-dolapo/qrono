import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useInbox } from "../../inbox/InboxProvider";
import type { InboxAction, InboxData, InboxItem } from "../../inbox/types";
import { ApiError, api } from "../../lib/api";
import { colors, font, radius, space } from "../../theme";

const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d` : new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

/** Things waiting on you, and what's happened, across your teams. Items leave once handled. */
export default function Inbox() {
  const { data, error, refreshing, refresh, setData } = useInbox();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const list = useRef<FlatList<InboxItem>>(null);
  const items = data?.items ?? [];

  // Opened from a push: scroll to that item and count it as seen.
  useEffect(() => {
    if (!focus || !data) return;
    const index = data.items.findIndex((i) => i.key === focus);
    if (index >= 0) {
      list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.2 });
      void api<InboxData>("/me/inbox/read", { method: "POST", body: { keys: [focus] } })
        .then(setData)
        .catch(() => undefined);
    }
  }, [focus, data?.items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function markAllRead() {
    try {
      setData(await api<InboxData>("/me/inbox/read", { method: "POST", body: {} }));
    } catch {
      Alert.alert("Couldn't update", "Check your connection and try again.");
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Inbox
        </Text>
        {data && data.unread > 0 ? (
          <Pressable onPress={markAllRead} hitSlop={10} accessibilityRole="button">
            <Text style={styles.markRead}>Mark all read</Text>
          </Pressable>
        ) : null}
      </View>
      <FlatList
        ref={list}
        data={items}
        keyExtractor={(i) => i.key}
        renderItem={({ item }) => <InboxCard item={item} highlighted={item.key === focus} />}
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        contentContainerStyle={styles.content}
        onScrollToIndexFailed={() => undefined}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
        ListEmptyComponent={
          !data && !error ? (
            <ActivityIndicator color={colors.muted} style={{ marginTop: space.xxl }} />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{error ? "Couldn't load your Inbox" : "You're all caught up"}</Text>
              <Text style={styles.emptyBody}>
                {error ? error.message : "Approvals, new parts, comments and invitations show up here. Pull down to refresh."}
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const LABELS: Record<InboxAction, string> = {
  approve: "Approve",
  open: "Open",
  let_in: "Let in",
  decline_join: "Decline",
  confirm: "I'll be there",
  decline_part: "Can't make it",
  join_team: "Join team",
  decline_invite: "Decline",
  dismiss: "Dismiss",
};
const PRIMARY = new Set<InboxAction>(["approve", "let_in", "confirm", "join_team"]);

function InboxCard({ item, highlighted }: { item: InboxItem; highlighted: boolean }) {
  const { setData, refresh } = useInbox();
  const [busy, setBusy] = useState<InboxAction | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  const openEvent = () => {
    if (!item.eventId) return;
    router.push({ pathname: "/events/[id]", params: { id: item.eventId, team: item.teamName } });
  };

  /** Runs an action; the API call either returns the new Inbox or we reload it. */
  async function run(action: InboxAction, call: () => Promise<unknown>) {
    setBusy(action);
    try {
      const res = await call();
      if (res && typeof res === "object" && "items" in res) setData(res as InboxData);
      else await refresh();
    } catch (err) {
      Alert.alert("Couldn't do that", err instanceof ApiError ? err.message : "Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  function press(action: InboxAction) {
    const { ref } = item;
    switch (action) {
      case "open":
        if (ref.noteId) void run(action, () => api(`/me/inbox/notes/${ref.noteId}/done`, { method: "POST" }));
        else void api("/me/inbox/read", { method: "POST", body: { keys: [item.key] } }).then((d) => setData(d as InboxData)).catch(() => undefined);
        openEvent();
        return;
      case "dismiss":
        return void run(action, () => api(`/me/inbox/notes/${ref.noteId}/done`, { method: "POST" }));
      case "approve":
        return Alert.alert("Approve this program?", "Everyone on it will be emailed their part.", [
          { text: "Cancel", style: "cancel" },
          { text: "Approve", onPress: () => void run(action, () => api(`/events/${item.eventId}/approve`, { method: "POST" })) },
        ]);
      case "let_in":
        return void run(action, () => api(`/teams/${item.teamId}/members/${ref.membershipId}/approve`, { method: "POST", body: {} }));
      case "decline_join":
        return Alert.alert("Decline this request?", "They won't join the team.", [
          { text: "Cancel", style: "cancel" },
          { text: "Decline", style: "destructive", onPress: () => void run(action, () => api(`/teams/${item.teamId}/members/${ref.membershipId}`, { method: "DELETE" })) },
        ]);
      case "confirm":
        return void run(action, () => api(`/events/${item.eventId}/response`, { method: "POST", body: { response: "acknowledged" } }));
      case "decline_part":
        return setDeclining(true);
      case "join_team":
        return void run(action, () => api(`/me/invites/${ref.inviteId}/accept`, { method: "POST" }));
      case "decline_invite":
        return void run(action, () => api(`/me/invites/${ref.inviteId}/decline`, { method: "POST" }));
    }
  }

  const tappable = !!item.eventId;
  return (
    <Pressable
      onPress={tappable ? () => press("open") : undefined}
      disabled={!tappable}
      style={({ pressed }) => [styles.card, highlighted && styles.highlighted, pressed && styles.pressed]}
      accessibilityRole={tappable ? "button" : undefined}
      accessibilityHint={tappable ? "Opens the event" : undefined}
    >
      <View style={styles.cardTop}>
        <Text style={styles.team} numberOfLines={1}>
          {item.teamName}
        </Text>
        <View style={styles.meta}>
          <Text style={styles.time}>{ago(item.at)}</Text>
          {item.unread ? <View style={styles.unreadDot} accessibilityLabel="Unread" /> : null}
        </View>
      </View>
      <Text style={styles.cardTitle}>{item.title}</Text>
      <Text style={styles.cardBody}>{item.body}</Text>

      {declining ? (
        <View style={styles.declineBox}>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Tell the team why"
            placeholderTextColor="#6b6e78"
            style={styles.input}
            autoFocus
            maxLength={500}
          />
          <View style={styles.actions}>
            <ActionButton
              label="Send"
              primary
              busy={busy === "decline_part"}
              disabled={reason.trim().length < 3}
              onPress={() =>
                void run("decline_part", () => api(`/events/${item.eventId}/response`, { method: "POST", body: { response: "declined", reason: reason.trim() } }))
              }
            />
            <ActionButton label="Cancel" onPress={() => setDeclining(false)} />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          {item.actions.map((a) => (
            <ActionButton key={a} label={LABELS[a]} primary={PRIMARY.has(a)} busy={busy === a} disabled={busy !== null} onPress={() => press(a)} />
          ))}
        </View>
      )}
    </Pressable>
  );
}

function ActionButton({ label, primary, busy, disabled, onPress }: { label: string; primary?: boolean; busy?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [styles.action, primary && styles.actionPrimary, (pressed || disabled) && { opacity: 0.6 }]}
      accessibilityRole="button"
    >
      {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md },
  title: { color: colors.text, fontSize: 30, ...font("800") },
  markRead: { color: "#c48cff", fontSize: 14, ...font("600") },
  content: { paddingHorizontal: space.xl, paddingBottom: space.xxl, flexGrow: 1 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: space.lg, gap: 6 },
  highlighted: { borderColor: colors.accent },
  pressed: { opacity: 0.85 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  team: { flex: 1, color: colors.muted, fontSize: 12, ...font("600"), textTransform: "uppercase", letterSpacing: 0.5 },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  time: { color: colors.muted, fontSize: 12, ...font("400") },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#b98af5" },
  cardTitle: { color: colors.text, fontSize: 16, lineHeight: 21, ...font("600") },
  cardBody: { color: colors.muted, fontSize: 14, lineHeight: 20, ...font("400") },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm },
  action: { minHeight: 38, paddingHorizontal: space.lg, borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  actionPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  actionText: { color: colors.text, fontSize: 14, ...font("600") },
  actionTextPrimary: { color: "#ffffff" },
  declineBox: { gap: space.xs, marginTop: space.sm },
  input: { minHeight: 42, borderRadius: radius.md, backgroundColor: "#17181d", color: colors.text, paddingHorizontal: space.md, fontSize: 15, ...font("400") },
  empty: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: space.lg, gap: space.sm, marginTop: space.md },
  emptyTitle: { color: colors.text, fontSize: 16, ...font("600") },
  emptyBody: { color: colors.muted, fontSize: 14, lineHeight: 20, ...font("400") },
});

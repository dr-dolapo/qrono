import { router } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { dayHeading, dayOf } from "../calendar/dates";
import { ArchiveIcon } from "../components/TabIcons";
import type { ArchiveOutcome, ArchivedItem } from "../inbox/types";
import { useApi } from "../lib/useApi";
import { deviceTimeZone, formatTime } from "../lib/time";
import { colors, font, radius, space } from "../theme";

/** What you did, in a few words; the ticks are for yes-type answers, the crosses for no. */
const OUTCOME: Record<ArchiveOutcome, { label: string; yes: boolean }> = {
  approved: { label: "Approved", yes: true },
  confirmed: { label: "You'll be there", yes: true },
  declined_part: { label: "Can't make it", yes: false },
  let_in: { label: "Let in", yes: true },
  declined_join: { label: "Declined", yes: false },
  joined_team: { label: "Joined", yes: true },
  declined_invite: { label: "Declined", yes: false },
  opened: { label: "Opened", yes: true },
  dismissed: { label: "Dismissed", yes: false },
};

/** Inbox items you've dealt with, newest first, grouped by day. Kept for 60 days. */
export default function Archived() {
  const { data, error, loading, refreshing, refresh } = useApi<{ items: ArchivedItem[]; keepDays: number }>("/me/inbox/archive");
  const keepDays = data?.keepDays ?? 60;

  const sections: { key: string; title: string; data: ArchivedItem[] }[] = [];
  for (const item of data?.items ?? []) {
    const day = dayOf(item.at);
    const last = sections.at(-1);
    if (last?.key === day) last.data.push(item);
    else sections.push({ key: day, title: dayHeading(day).toUpperCase(), data: [item] });
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back} accessibilityRole="button" accessibilityLabel="Back to Inbox">
          <Text style={styles.backText}>‹ Inbox</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Archived
        </Text>
        {sections.length ? <Text style={styles.sub}>Everything you've approved, answered or dismissed.</Text> : null}
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(i) => i.key}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <Text style={styles.day}>{section.title}</Text>}
        renderItem={({ item }) => <Row item={item} />}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.muted} style={{ marginTop: space.xxl }} />
          ) : (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <ArchiveIcon color={colors.muted} size={32} />
              </View>
              <Text style={styles.emptyTitle}>{error ? "Couldn't load Archived" : "Nothing archived yet"}</Text>
              <Text style={styles.emptyBody}>{error ? error.message : "Approvals, parts and invitations you answer will be kept here."}</Text>
            </View>
          )
        }
        ListFooterComponent={<Text style={styles.note}>Archived items are cleared after {keepDays} days.</Text>}
        ListFooterComponentStyle={styles.footer}
      />
    </SafeAreaView>
  );
}

function Row({ item }: { item: ArchivedItem }) {
  const o = OUTCOME[item.outcome];
  const open = item.eventId ? () => router.push({ pathname: "/events/[id]", params: { id: item.eventId!, team: item.teamName ?? "" } }) : undefined;
  return (
    <Pressable
      onPress={open}
      disabled={!open}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
      accessibilityRole={open ? "button" : undefined}
      accessibilityLabel={`${o.label}: ${item.title}${item.teamName ? `, ${item.teamName}` : ""}`}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.outcome}>
          <Text style={[styles.mark, { color: o.yes ? "#b98af5" : colors.muted }]}>{o.yes ? "✓" : "✕"}</Text>
          <Text style={[styles.outcomeText, { color: o.yes ? "#b98af5" : colors.muted }]}>{o.label}</Text>
        </View>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.title}
        </Text>
        {item.detail || item.teamName ? (
          <Text style={styles.rowMeta} numberOfLines={2}>
            {[item.teamName, item.detail].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
      </View>
      <Text style={styles.time}>{formatTime(item.at, deviceTimeZone())}</Text>
      {open ? <Text style={styles.chev}>›</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  header: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.sm, gap: 4 },
  back: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", marginLeft: -2 },
  backText: { color: "#c48cff", fontSize: 17, ...font("500") },
  title: { color: colors.text, fontSize: 30, ...font("800") },
  sub: { color: colors.muted, fontSize: 14, ...font("400") },
  content: { paddingHorizontal: space.xl, paddingBottom: space.lg, flexGrow: 1 },
  day: { color: colors.muted, fontSize: 12, letterSpacing: 0.9, ...font("700"), marginTop: space.lg, marginBottom: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  outcome: { flexDirection: "row", alignItems: "center", gap: 6 },
  mark: { fontSize: 12, ...font("700") },
  outcomeText: { fontSize: 12, ...font("600") },
  rowTitle: { color: colors.text, fontSize: 15, ...font("500") },
  rowMeta: { color: colors.muted, fontSize: 13, lineHeight: 18, ...font("400") },
  time: { color: colors.muted, fontSize: 12, ...font("400") },
  chev: { color: colors.muted, fontSize: 22, lineHeight: 24 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingBottom: space.xxl },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  emptyTitle: { color: colors.text, fontSize: 20, ...font("700") },
  emptyBody: { color: colors.muted, fontSize: 15, lineHeight: 22, maxWidth: 270, textAlign: "center", ...font("400") },
  footer: { marginTop: "auto", paddingTop: space.xl },
  note: { color: colors.muted, fontSize: 12, lineHeight: 16, textAlign: "center", ...font("400") },
});

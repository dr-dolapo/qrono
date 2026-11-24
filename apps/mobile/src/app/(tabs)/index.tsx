import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../auth/AuthProvider";
import { MonthSheet } from "../../calendar/MonthSheet";
import { WeekStrip } from "../../calendar/WeekStrip";
import { dayHeading, dayOf, fromKey, monthLabel, todayKey } from "../../calendar/dates";
import { Button } from "../../components/Button";
import { CalendarIcon } from "../../components/TabIcons";
import { EventCard } from "../../events/EventCard";
import type { MyEvent } from "../../events/types";
import { VerifyEmailBanner } from "../../events/VerifyEmailBanner";
import { useApi } from "../../lib/useApi";
import { useNow } from "../../lib/useNow";
import { colors, font, radius, space } from "../../theme";

type Row = { kind: "event"; event: MyEvent } | { kind: "empty"; next: MyEvent | null };

/**
 * Events: a week strip to move between days, a month sheet to jump to a date, and
 * every event from the chosen day on, grouped by day. Opens on today.
 */
export default function Events() {
  const { user } = useAuth();
  const { data, error, loading, refreshing, refresh } = useApi<{ events: MyEvent[] }>("/me/events");
  const now = useNow(30_000);
  const [selected, setSelected] = useState(todayKey);
  const [monthOpen, setMonthOpen] = useState(false);
  const list = useRef<SectionList<Row>>(null);

  const events = useMemo(() => [...(data?.events ?? [])].sort((a, b) => a.startAt.localeCompare(b.startAt)), [data]);
  const eventDays = useMemo(() => new Set(events.map((e) => dayOf(e.startAt))), [events]);

  // The chosen day first (with a note if it's empty), then every later day that has events.
  const sections = useMemo(() => {
    const byDay = new Map<string, MyEvent[]>();
    for (const e of events) {
      const day = dayOf(e.startAt);
      if (day < selected) continue;
      byDay.set(day, [...(byDay.get(day) ?? []), e]);
    }
    const out: { key: string; title: string; data: Row[] }[] = [];
    if (!byDay.has(selected)) {
      const next = events.find((e) => dayOf(e.startAt) > selected) ?? null;
      out.push({ key: selected, title: dayHeading(selected), data: [{ kind: "empty", next }] });
    }
    for (const [day, list] of byDay) out.push({ key: day, title: dayHeading(day), data: list.map((event) => ({ kind: "event", event })) });
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }, [events, selected]);

  const choose = (key: string) => {
    setSelected(key);
    // The list starts at the chosen day, so go back to the top of it.
    requestAnimationFrame(() => list.current?.getScrollResponder()?.scrollTo({ y: 0, animated: false }));
  };

  const unverified = user && !user.emailVerified;
  const blockedByEmail = error?.code === "email_unverified";

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Events
        </Text>
        <View style={styles.headerActions}>
          {selected !== todayKey() ? (
            <Pressable onPress={() => choose(todayKey())} style={styles.chip} accessibilityRole="button">
              <Text style={styles.chipText}>Today</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setMonthOpen(true)}
            style={styles.monthButton}
            accessibilityRole="button"
            accessibilityLabel={`${monthLabel(fromKey(selected))}. Go to a date`}
          >
            <Text style={styles.monthText}>{monthLabel(fromKey(selected))}</Text>
            <CalendarIcon color={colors.text} size={18} />
          </Pressable>
        </View>
      </View>

      <WeekStrip selected={selected} eventDays={eventDays} onSelect={choose} />

      <SectionList
        ref={list}
        sections={sections}
        keyExtractor={(row, i) => (row.kind === "event" ? row.event.id : `empty-${i}`)}
        renderItem={({ item }) =>
          item.kind === "event" ? (
            <EventCard event={item.event} now={now} />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{selected === todayKey() ? "Nothing today" : "Nothing on this day"}</Text>
              {item.next ? (
                <Pressable onPress={() => choose(dayOf(item.next!.startAt))} accessibilityRole="button" style={styles.nextLink}>
                  <Text style={styles.nextText}>
                    Next: {item.next.name} · {dayHeading(dayOf(item.next.startAt))} ›
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.emptyBody}>Nothing coming up after this.</Text>
              )}
            </View>
          )
        }
        renderSectionHeader={({ section }) => <Text style={styles.dayTitle}>{section.title}</Text>}
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.content}
        onScrollToIndexFailed={() => undefined}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
        ListHeaderComponent={unverified || blockedByEmail ? <VerifyEmailBanner email={user?.email ?? "your email"} onConfirmed={refresh} /> : undefined}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.muted} style={{ marginTop: space.xxl }} />
          ) : error && !blockedByEmail ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Couldn't load your events</Text>
              <Text style={styles.emptyBody}>{error.message}</Text>
              <Button label="Try again" variant="secondary" onPress={refresh} />
            </View>
          ) : undefined
        }
      />

      <MonthSheet visible={monthOpen} selected={selected} eventDays={eventDays} onSelect={choose} onClose={() => setMonthOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md },
  title: { color: colors.text, fontSize: 30, ...font("800") },
  headerActions: { flexDirection: "row", alignItems: "center", gap: space.sm },
  chip: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chipText: { color: colors.text, fontSize: 13, ...font("600") },
  monthButton: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: space.md, paddingRight: space.md, paddingVertical: 7, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.07)" },
  monthText: { color: colors.text, fontSize: 13, ...font("600") },
  content: { paddingHorizontal: space.xl, paddingBottom: space.xxl, flexGrow: 1 },
  dayTitle: { color: colors.muted, fontSize: 13, ...font("700"), letterSpacing: 0.6, textTransform: "uppercase", marginTop: space.xl, marginBottom: space.md },
  empty: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  emptyTitle: { color: colors.text, fontSize: 16, ...font("600") },
  emptyBody: { color: colors.muted, fontSize: 14, ...font("400"), lineHeight: 20 },
  nextLink: { paddingVertical: 2 },
  nextText: { color: "#c48cff", fontSize: 14, ...font("600") },
});

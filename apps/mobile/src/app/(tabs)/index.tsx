import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
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
import { OfflineBanner } from "../../components/OfflineBanner";
import { saveUpcoming } from "../../lib/prefetch";
import { useCachedApi } from "../../lib/useCachedApi";
import { useNow } from "../../lib/useNow";
import { colors, font, radius, space } from "../../theme";

type Row = { kind: "event"; event: MyEvent } | { kind: "empty"; next: MyEvent | null };

/**
 * Events: a week strip to move between days, a month sheet to jump to a date, and the
 * events on the chosen day (only that day). Opens on today.
 */
export default function Events() {
  const { user } = useAuth();
  // The saved list first, then a check for changes (every 5 minutes while it's open).
  const { data, error, loading, refreshing, refresh, savedAt } = useCachedApi<{ events: MyEvent[] }>("/me/events", "events", () => 5 * 60_000);
  // Each time the list is fresh, save the next 14 days of events so they open instantly, even offline.
  useEffect(() => {
    if (data) void saveUpcoming(data.events);
  }, [data, savedAt]);
  // Admins and Planners can start a program from here.
  const { data: teams } = useCachedApi<{ teams: { role: string; status: string }[] }>("/teams", "teams", () => 30 * 60_000);
  const canCreate = (teams?.teams ?? []).some((t) => t.status === "active" && (t.role === "approver" || t.role === "admin"));
  const now = useNow(30_000);
  const [selected, setSelected] = useState(todayKey);
  const [monthOpen, setMonthOpen] = useState(false);
  const list = useRef<SectionList<Row>>(null);

  const events = useMemo(() => [...(data?.events ?? [])].sort((a, b) => a.startAt.localeCompare(b.startAt)), [data]);
  const eventDays = useMemo(() => new Set(events.map((e) => dayOf(e.startAt))), [events]);

  // Only the chosen day. An empty day says so and points to the next event.
  const sections = useMemo(() => {
    const today = events.filter((e) => dayOf(e.startAt) === selected);
    const rows: Row[] = today.length
      ? today.map((event) => ({ kind: "event", event }))
      : [{ kind: "empty", next: events.find((e) => dayOf(e.startAt) > selected) ?? null }];
    return [{ key: selected, title: dayHeading(selected), data: rows }];
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
      <OfflineBanner savedAt={savedAt} />
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
          {canCreate ? (
            <Pressable
              onPress={() => router.push({ pathname: "/events/new", params: { day: selected >= todayKey() ? selected : todayKey() } })}
              style={({ pressed }) => [styles.add, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel="New program"
            >
              <Text style={styles.addText}>+</Text>
            </Pressable>
          ) : null}
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
            <FreeDay day={selected} next={item.next} onNext={(day) => choose(day)} />
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

const FREE_DAY = require("../../../assets/free-day.png");

/**
 * A day with nothing on it: no card (so it can't be mistaken for an event), just a calendar
 * with a tick, "A free day", and a way to the next event.
 */
function FreeDay({ day, next, onNext }: { day: string; next: MyEvent | null; onNext(day: string): void }) {
  const when = dayHeading(day);
  const which = when === "Today" || when === "Tomorrow" || when === "Yesterday" ? when.toLowerCase() : `on ${fromKey(day).toLocaleDateString("en-GB", { weekday: "long" })}`;
  const nextDay = next ? dayOf(next.startAt) : null;
  return (
    <View style={styles.free}>
      <Image source={FREE_DAY} style={styles.freeImage} accessibilityIgnoresInvertColors accessible={false} />
      <Text style={styles.freeTitle} accessibilityRole="header">
        A free day
      </Text>
      <Text style={styles.freeBody}>Nothing is planned {which}.</Text>
      {next && nextDay ? (
        <Pressable
          onPress={() => onNext(nextDay)}
          accessibilityRole="button"
          accessibilityHint="Goes to that day"
          style={({ pressed }) => [styles.freeButton, pressed && { opacity: 0.75 }]}
        >
          <Text style={styles.freeButtonText} numberOfLines={1}>
            Next: {next.name} · {shortDay(nextDay)}
          </Text>
        </Pressable>
      ) : (
        <Text style={styles.freeBody}>Nothing coming up after this.</Text>
      )}
    </View>
  );
}

const shortDay = (key: string) => {
  const h = dayHeading(key);
  return h === "Today" || h === "Tomorrow" ? h : fromKey(key).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
};

const styles = StyleSheet.create({
  free: { minHeight: 420, alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.xl, paddingBottom: space.xxl },
  freeImage: { width: 72, height: 72 },
  freeTitle: { color: colors.text, fontSize: 20, textAlign: "center", ...font("800") },
  freeBody: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: "center", ...font("400") },
  freeButton: { marginTop: 6, minHeight: 44, maxWidth: "100%", paddingHorizontal: 18, borderRadius: 999, justifyContent: "center", backgroundColor: "#1d1430", borderWidth: 1, borderColor: "#3b2160" },
  freeButtonText: { color: colors.text, fontSize: 14, ...font("600") },
  safe: { flex: 1, backgroundColor: "transparent" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md },
  title: { color: colors.text, fontSize: 30, ...font("800") },
  headerActions: { flexDirection: "row", alignItems: "center", gap: space.sm },
  chip: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chipText: { color: colors.text, fontSize: 13, ...font("600") },
  monthButton: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: space.md, paddingRight: space.md, paddingVertical: 7, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.07)" },
  add: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  addText: { color: "#fff", fontSize: 24, lineHeight: 26, marginTop: -2, ...font("500") },
  monthText: { color: colors.text, fontSize: 13, ...font("600") },
  content: { paddingHorizontal: space.xl, paddingBottom: space.xxl, flexGrow: 1 },
  dayTitle: { color: colors.muted, fontSize: 13, ...font("700"), letterSpacing: 0.6, textTransform: "uppercase", marginTop: space.xl, marginBottom: space.md },
  empty: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  emptyTitle: { color: colors.text, fontSize: 16, ...font("600") },
  emptyBody: { color: colors.muted, fontSize: 14, ...font("400"), lineHeight: 20 },
});

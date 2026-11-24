import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, font, radius, space } from "../theme";
import { WEEKDAYS, addDays, dayKey, fromKey, monthLabel, todayKey, weekStart } from "./dates";

/** A month grid that slides up from the bottom. Days with events have a dot; tap a day to jump to it. */
export function MonthSheet({
  visible,
  selected,
  eventDays,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected: string;
  eventDays: Set<string>;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [month, setMonth] = useState(() => startOfMonth(fromKey(selected)));
  useEffect(() => {
    if (visible) setMonth(startOfMonth(fromKey(selected)));
  }, [visible, selected]);

  const first = weekStart(month);
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const today = todayKey();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close calendar" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.handle} />
        <View style={styles.head}>
          <Pressable onPress={() => setMonth(addMonths(month, -1))} hitSlop={12} accessibilityRole="button" accessibilityLabel="Previous month">
            <Text style={styles.arrow}>‹</Text>
          </Pressable>
          <Text style={styles.month} accessibilityRole="header">
            {monthLabel(month)}
          </Text>
          <Pressable onPress={() => setMonth(addMonths(month, 1))} hitSlop={12} accessibilityRole="button" accessibilityLabel="Next month">
            <Text style={styles.arrow}>›</Text>
          </Pressable>
        </View>
        <View style={styles.row}>
          {WEEKDAYS.map((l, i) => (
            <Text key={i} style={styles.weekday}>
              {l}
            </Text>
          ))}
        </View>
        <View style={styles.grid}>
          {days.map((d) => {
            const key = dayKey(d);
            const inMonth = d.getMonth() === month.getMonth();
            const on = key === selected;
            return (
              <Pressable
                key={key}
                style={styles.cell}
                onPress={() => {
                  onSelect(key);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}${eventDays.has(key) ? ", has events" : ""}`}
              >
                <View style={[styles.num, key === today && styles.today, on && styles.numOn]}>
                  <Text style={[styles.numText, !inMonth && styles.outside, on && styles.numTextOn]}>{d.getDate()}</Text>
                </View>
                <View style={[styles.dot, eventDays.has(key) && styles.dotOn]} />
              </Pressable>
            );
          })}
        </View>
        <Pressable
          style={styles.todayButton}
          onPress={() => {
            onSelect(today);
            onClose();
          }}
          accessibilityRole="button"
        >
          <Text style={styles.todayText}>Go to today</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    backgroundColor: "#121117",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
  },
  handle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.25)", marginBottom: space.md },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.sm, marginBottom: space.md },
  arrow: { color: colors.text, fontSize: 30, lineHeight: 32, paddingHorizontal: space.md },
  month: { color: colors.text, fontSize: 18, ...font("600") },
  row: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", color: colors.muted, fontSize: 12, ...font("500"), marginBottom: space.xs },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, alignItems: "center", paddingVertical: 3, gap: 2 },
  num: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  today: { borderWidth: 1.5, borderColor: "rgba(185,138,245,0.7)" },
  numOn: { backgroundColor: colors.accent, borderWidth: 0 },
  numText: { color: colors.text, fontSize: 16, ...font("500") },
  numTextOn: { color: "#ffffff", ...font("700") },
  outside: { color: "#55565e" },
  dot: { width: 5, height: 5, borderRadius: 3 },
  dotOn: { backgroundColor: "#b98af5" },
  todayButton: { alignSelf: "center", marginTop: space.md, paddingVertical: space.sm, paddingHorizontal: space.lg, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.08)" },
  todayText: { color: colors.text, fontSize: 15, ...font("600") },
});

import { useEffect, useMemo, useRef } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { colors, font } from "../theme";
import { WEEKDAYS, addDays, dayKey, fromKey, todayKey, weekStart } from "./dates";

const WEEKS_BACK = 52;
const WEEKS_AHEAD = 104;

/**
 * A week of days at a time; swipe for the next or previous week. Days with events
 * have a dot. The selected day is filled purple, today has a ring.
 */
export function WeekStrip({ selected, eventDays, onSelect }: { selected: string; eventDays: Set<string>; onSelect: (key: string) => void }) {
  const { width } = useWindowDimensions();
  const list = useRef<FlatList<Date>>(null);
  const thisWeek = useMemo(() => weekStart(new Date()), []);
  const weeks = useMemo(() => Array.from({ length: WEEKS_BACK + WEEKS_AHEAD + 1 }, (_, i) => addDays(thisWeek, (i - WEEKS_BACK) * 7)), [thisWeek]);
  const today = todayKey();

  // Keep the selected day's week in view (e.g. after choosing a date in the month sheet).
  const selectedWeek = useMemo(
    () => Math.round((weekStart(fromKey(selected)).getTime() - thisWeek.getTime()) / (7 * 86_400_000)) + WEEKS_BACK,
    [selected, thisWeek],
  );
  useEffect(() => {
    if (selectedWeek >= 0 && selectedWeek < weeks.length) list.current?.scrollToIndex({ index: selectedWeek, animated: true });
  }, [selectedWeek, weeks.length]);

  return (
    <FlatList
      ref={list}
      data={weeks}
      horizontal
      style={styles.strip}
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      initialScrollIndex={WEEKS_BACK}
      getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
      keyExtractor={(d) => dayKey(d)}
      windowSize={3}
      initialNumToRender={1}
      renderItem={({ item }) => (
        <View style={[styles.week, { width }]}>
          {WEEKDAYS.map((letter, i) => {
            const date = addDays(item, i);
            const key = dayKey(date);
            const on = key === selected;
            const isToday = key === today;
            return (
              <Pressable
                key={key}
                onPress={() => onSelect(key)}
                style={styles.day}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}${eventDays.has(key) ? ", has events" : ""}`}
              >
                <Text style={[styles.letter, on && styles.letterOn]}>{letter}</Text>
                <View style={[styles.num, isToday && styles.today, on && styles.numOn]}>
                  <Text style={[styles.numText, on && styles.numTextOn]}>{date.getDate()}</Text>
                </View>
                <View style={[styles.dot, eventDays.has(key) && styles.dotOn, on && eventDays.has(key) && styles.dotSelected]} />
              </Pressable>
            );
          })}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  // A horizontal list grows to fill the screen unless told not to.
  strip: { flexGrow: 0, flexShrink: 0 },
  week: { flexDirection: "row", paddingHorizontal: 12 },
  day: { flex: 1, alignItems: "center", gap: 6, paddingVertical: 4 },
  letter: { color: colors.muted, fontSize: 12, ...font("500") },
  letterOn: { color: colors.text },
  num: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  today: { borderWidth: 1.5, borderColor: "rgba(185,138,245,0.7)" },
  numOn: { backgroundColor: colors.accent, borderWidth: 0 },
  numText: { color: colors.text, fontSize: 16, ...font("600") },
  numTextOn: { color: "#ffffff" },
  dot: { width: 5, height: 5, borderRadius: 3 },
  dotOn: { backgroundColor: "#b98af5" },
  dotSelected: { backgroundColor: colors.text },
});

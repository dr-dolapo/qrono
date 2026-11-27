import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MonthSheet } from "../calendar/MonthSheet";
import { fromKey } from "../calendar/dates";
import { colors, font } from "../theme";

/**
 * A date and a start time, phone-first: the date from the month calendar, the time from a
 * row of hours and four quarter-hour chips (programs start on the quarter hour).
 */
export function WhenPicker({
  day,
  minutes,
  onChange,
  clock = "12h",
}: {
  /** "2026-11-29" */
  day: string;
  /** Minutes into the day, on the quarter hour. */
  minutes: number;
  onChange(day: string, minutes: number): void;
  clock?: "12h" | "24h";
}) {
  const [calendar, setCalendar] = useState(false);
  const hour = Math.floor(minutes / 60);
  const quarter = minutes % 60;
  const hourLabel = (h: number) => (clock === "24h" ? `${String(h).padStart(2, "0")}` : `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`);

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 8 }}>
        <Text style={styles.label}>Date</Text>
        <Pressable onPress={() => setCalendar(true)} accessibilityRole="button" accessibilityHint="Opens a calendar" style={({ pressed }) => [styles.field, pressed && { opacity: 0.8 }]}>
          <Text style={styles.fieldText}>{fromKey(day).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</Text>
          <Text style={styles.change}>Change</Text>
        </Pressable>
      </View>
      <View style={{ gap: 8 }}>
        <Text style={styles.label}>Starts at</Text>
        {/* Starts scrolled to the morning, where most programs begin. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentOffset={{ x: Math.max(0, hour - 2) * 76, y: 0 }} contentContainerStyle={{ gap: 8 }}>
          {Array.from({ length: 24 }, (_, h) => (
            <Pressable
              key={h}
              onPress={() => onChange(day, h * 60 + quarter)}
              accessibilityRole="radio"
              accessibilityState={{ selected: h === hour }}
              style={({ pressed }) => [styles.chip, { width: 68 }, h === hour && styles.chipOn, pressed && { opacity: 0.8 }]}
            >
              <Text style={[styles.chipText, h === hour && styles.on]}>{hourLabel(h)}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {[0, 15, 30, 45].map((m) => (
            <Pressable
              key={m}
              onPress={() => onChange(day, hour * 60 + m)}
              accessibilityRole="radio"
              accessibilityLabel={`${m} minutes past`}
              accessibilityState={{ selected: m === quarter }}
              style={({ pressed }) => [styles.chip, { flex: 1 }, m === quarter && styles.chipOn, pressed && { opacity: 0.8 }]}
            >
              <Text style={[styles.chipText, m === quarter && styles.on]}>:{String(m).padStart(2, "0")}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <MonthSheet visible={calendar} selected={day} eventDays={new Set()} onSelect={(d) => (onChange(d, minutes), setCalendar(false))} onClose={() => setCalendar(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.muted, fontSize: 13, ...font("600") },
  field: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: "#0b0c10", paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fieldText: { color: colors.text, fontSize: 16, ...font("500") },
  change: { color: "#c48cff", fontSize: 14, ...font("600") },
  chip: { height: 42, borderRadius: 21, borderWidth: 1, borderColor: colors.border, backgroundColor: "#16171d", alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 14, ...font("600") },
  on: { color: "#fff" },
});

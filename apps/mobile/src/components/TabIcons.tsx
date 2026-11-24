import { StyleSheet, Text, View } from "react-native";
import { font } from "../theme";

/**
 * The tab bar's icons, drawn with plain views (no icon font or SVG module needed),
 * in the line style of iOS's Chrome tab bar.
 */
const STROKE = 2.4;

export function CalendarIcon({ color }: { color: string }) {
  return (
    <View style={styles.box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.calendar, { borderColor: color }]}>
        <View style={[styles.calendarBar, { backgroundColor: color }]} />
        <View style={styles.calendarDots}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.dot, { backgroundColor: color }]} />
          ))}
        </View>
      </View>
      <View style={[styles.peg, { left: 8, backgroundColor: color }]} />
      <View style={[styles.peg, { right: 8, backgroundColor: color }]} />
    </View>
  );
}

/** A rounded square holding the unread count, like Chrome's open-tabs counter. Empty: a tray. */
export function InboxIcon({ color, count }: { color: string; count: number }) {
  const label = count > 99 ? "99+" : String(count);
  return (
    <View style={styles.box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.square, { borderColor: color }]}>
        {count > 0 ? (
          <Text style={[styles.count, { color }, label.length > 2 && styles.countSmall]} allowFontScaling={false}>
            {label}
          </Text>
        ) : (
          <View style={[styles.tray, { borderColor: color }]} />
        )}
      </View>
    </View>
  );
}

export function ProfileIcon({ color }: { color: string }) {
  return (
    <View style={styles.box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.ring, { borderColor: color }]}>
        <View style={[styles.head, { borderColor: color }]} />
        <View style={[styles.shoulders, { borderColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  calendar: { width: 28, height: 26, marginTop: 4, borderWidth: STROKE, borderRadius: 7, overflow: "hidden" },
  calendarBar: { height: STROKE, marginTop: 5 },
  calendarDots: { flexDirection: "row", justifyContent: "center", gap: 4, marginTop: 5 },
  dot: { width: 3.5, height: 3.5, borderRadius: 2 },
  peg: { position: "absolute", top: 1, width: STROKE, height: 7, borderRadius: 2 },
  square: { width: 30, height: 30, borderWidth: STROKE, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  count: { fontSize: 14, lineHeight: 17, ...font("700") },
  countSmall: { fontSize: 11 },
  tray: { width: 14, height: 7, borderWidth: STROKE, borderTopWidth: 0, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, marginTop: 4 },
  ring: { width: 30, height: 30, borderRadius: 15, borderWidth: STROKE, alignItems: "center", overflow: "hidden" },
  head: { width: 10, height: 10, borderRadius: 5, borderWidth: STROKE, marginTop: 4 },
  shoulders: { width: 20, height: 14, borderRadius: 10, borderWidth: STROKE, marginTop: 2 },
});

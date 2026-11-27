import { StyleSheet, Text, View } from "react-native";
import { useOnline } from "../lib/connectivity";
import { usePendingCount } from "../lib/outbox";
import { deviceTimeZone, formatTime } from "../lib/time";
import { font } from "../theme";

/**
 * "Offline · Updated 11:42": shown while the server can't be reached, so people
 * know what they see is the saved copy. `tint` lets the event screen draw it in a darker shade
 * of its pushdown instead of a grey bar.
 */
export function OfflineBanner({ savedAt, following, tint, color }: { savedAt: number | null; following?: boolean; tint?: string; color?: string }) {
  const online = useOnline();
  const pending = usePendingCount();
  if (online && pending === 0) return null;
  const parts = [online ? "Back online" : "Offline"];
  if (!online && savedAt) parts.push(`Updated ${formatTime(new Date(savedAt).toISOString(), deviceTimeZone())}`);
  if (!online && following) parts.push("Following the plan");
  if (pending > 0) parts.push(pending === 1 ? "1 change waiting to send" : `${pending} changes waiting to send`);
  return (
    <View style={[styles.banner, { backgroundColor: tint ?? "#3a2a05" }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <View style={[styles.dot, { backgroundColor: online ? "#4ade80" : "#f5b301" }]} />
      <Text style={[styles.text, { color: color ?? "#fde7a8" }]} numberOfLines={2}>
        {parts.join(" · ")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 16 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: 13, textAlign: "center", flexShrink: 1, ...font("600") },
});

import { StyleSheet, Text, View } from "react-native";
import type { EventStatus } from "../events/types";
import { colors, space } from "../theme";

const LABELS: Record<EventStatus, string> = {
  draft: "Draft",
  review: "In review",
  approved: "Approved",
  live: "Live now",
  past: "Ended",
};

export function StatusPill({ status }: { status: EventStatus }) {
  const live = status === "live";
  return (
    <View style={[styles.pill, live ? styles.live : null]}>
      {live ? <View style={styles.dot} /> : null}
      <Text style={[styles.text, live ? styles.liveText : null]}>{LABELS[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  live: { backgroundColor: colors.liveSurface },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.live },
  text: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  liveText: { color: colors.live },
});

import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from "expo-router/ui";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CalendarIcon, InboxIcon, ProfileIcon } from "../../components/TabIcons";
import { InboxProvider, useInbox } from "../../inbox/InboxProvider";
import { backdrop, font } from "../../theme";

const ACTIVE = "#b98af5"; // Qrono purple, lifted for the dark bar
const INACTIVE = "#f4f5f7";
const LIFT = 22; // raises the tabs off the bottom edge by about a label's height
const CORNER = 34; // the page card's rounded bottom, like a phone's curved screen edge

// TabTrigger (asChild) passes its ref through the spread props at runtime; its type for it is wrong.
type TabButtonProps = Omit<TabTriggerSlotProps, "ref"> & { label: string; icon: (color: string) => ReactNode; badge?: string };

/** One tab: icon over label, purple when selected. */
function TabButton({ label, icon, badge, isFocused, ...props }: TabButtonProps) {
  const color = isFocused ? ACTIVE : INACTIVE;
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!isFocused }}
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
    >
      {icon(color)}
      <Text style={[styles.label, { color }]} allowFontScaling={false}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Events, Inbox and Profile. The page sits on a card whose rounded bottom corners
 * lift off a black-to-purple bar, like the curved edge of a modern phone.
 */
export default function TabsLayout() {
  return (
    <InboxProvider>
      <TabsFrame />
    </InboxProvider>
  );
}

// The triggers must sit right here inside <Tabs>: it reads them from its own
// children to know the routes, and can't see into another component.
function TabsFrame() {
  const insets = useSafeAreaInsets();
  const { data } = useInbox();
  const unread = data?.unread ?? 0;
  return (
    <Tabs style={styles.frame}>
      <View style={styles.card}>
        <TabSlot style={styles.slot} />
      </View>
      <TabList style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) + LIFT }]}>
        <TabTrigger name="index" href="/" asChild>
          <TabButton label="Events" icon={(c) => <CalendarIcon color={c} />} />
        </TabTrigger>
        <TabTrigger name="inbox" href="/inbox" asChild>
          <TabButton label="Inbox" icon={(c) => <InboxIcon color={c} count={unread} />} badge={unread ? `${unread} unread` : undefined} />
        </TabTrigger>
        <TabTrigger name="profile" href="/profile" asChild>
          <TabButton label="Profile" icon={(c) => <ProfileIcon color={c} />} />
        </TabTrigger>
      </TabList>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  // Painted behind everything: shows at the card's corners and under the tabs.
  frame: {
    flex: 1,
    backgroundColor: "#0b0810",
    experimental_backgroundImage: "linear-gradient(180deg, #0d0a12 0%, #0d0a12 70%, #1c0d2e 88%, #2e1150 100%)",
  },
  card: {
    ...backdrop,
    borderBottomLeftRadius: CORNER,
    borderBottomRightRadius: CORNER,
    overflow: "hidden",
    // A hairline and soft shadow so the curve reads against the bar.
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
    boxShadow: "0 10px 24px rgba(0,0,0,0.55)",
  },
  slot: { flex: 1 },
  bar: { flexDirection: "row", paddingTop: 12, paddingHorizontal: 12, backgroundColor: "transparent" },
  tab: { flex: 1, alignItems: "center", gap: 5, paddingVertical: 2 },
  pressed: { opacity: 0.6 },
  label: { fontSize: 14, ...font("500") },
});

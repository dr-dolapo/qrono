import { Image, type ImageSourcePropType, StyleSheet, Text, View } from "react-native";
import { font } from "../theme";

/**
 * The tab bar's icons. White PNGs made from the SVGs in assets/tab-icons, tinted to
 * the tab's colour (PNG, not SVG, so no native module and the app still updates over the air).
 */
const SOURCES = {
  calendar: require("../../assets/tab-icons/calendar.png") as ImageSourcePropType,
  inbox: require("../../assets/tab-icons/inbox.png") as ImageSourcePropType,
  profile: require("../../assets/tab-icons/profile.png") as ImageSourcePropType,
  archive: require("../../assets/tab-icons/archive.png") as ImageSourcePropType,
  sparkle: require("../../assets/tab-icons/sparkle.png") as ImageSourcePropType,
  inboxLarge: require("../../assets/tab-icons/inbox-large.png") as ImageSourcePropType,
};

type IconProps = { color: string; size?: number };

function Icon({ name, color, size = 24 }: IconProps & { name: keyof typeof SOURCES }) {
  return (
    <Image
      source={SOURCES[name]}
      style={{ width: size, height: size, tintColor: color }}
      resizeMode="contain"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

export const CalendarIcon = (p: IconProps) => <Icon name="calendar" {...p} />;
export const ProfileIcon = (p: IconProps) => <Icon name="profile" {...p} />;
export const ArchiveIcon = (p: IconProps) => <Icon name="archive" {...p} />;
export const SparkleIcon = (p: IconProps) => <Icon name="sparkle" {...p} />;
/** The tray drawn large and crisp, for the empty Inbox. */
export const InboxLargeIcon = (p: IconProps) => <Icon name="inboxLarge" size={104} {...p} />;

/** The tray, with the unread count in a small purple badge on its corner. */
export function InboxIcon({ color, count, size = 24 }: IconProps & { count: number }) {
  const label = count > 99 ? "99+" : String(count);
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Icon name="inbox" color={color} size={size} />
      {count > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText} allowFontScaling={false}>
            {label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: -5,
    left: "60%",
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: "#a564f5",
    borderWidth: 1.5,
    borderColor: "#1c0d2e",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#ffffff", fontSize: 9, lineHeight: 11, ...font("700") },
});

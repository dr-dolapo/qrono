import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { activityBackgroundTint, font, foregroundStyle, lineLimit, padding } from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";
import { Platform } from "react-native";
import type { LiveCard } from "../../modules/qrono-live-updates/src";

/** Must match ACTIVITY_NAME in the API (apps/api/src/live/cards.ts). */
export const ACTIVITY_NAME = "QronoLive";

/**
 * The iOS Live Activity: Lock Screen banner and Dynamic Island. Purple while your part is
 * on now or up next; otherwise dark, showing the latest broadcast.
 */
function QronoLive(card: LiveCard, env: LiveActivityEnvironment) {
  "widget";
  const purple = "#b98af5";
  const muted = "#a3a6b1";
  const badge = card.urgent ? (card.headline.indexOf("next") >= 0 ? "Up next" : "On now") : env.isStale ? "Ended" : "Live";
  const broadcast = card.broadcast ? card.broadcast : "Messages from the organisers will show here.";

  return {
    banner: (
      <VStack alignment="leading" spacing={6} modifiers={[padding({ all: 16 }), activityBackgroundTint(card.urgent ? "#3b1466" : "#0d0a12")]}>
        <HStack spacing={6}>
          <Image systemName="dot.radiowaves.left.and.right" size={13} color={purple} />
          <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle(muted), lineLimit(1)]}>{card.eventName}</Text>
          <Spacer />
          <Text modifiers={[font({ size: 13, weight: "bold" }), foregroundStyle(card.urgent ? "#ffffff" : purple)]}>{badge}</Text>
        </HStack>
        {card.urgent ? (
          <Text modifiers={[font({ size: 20, weight: "bold" }), foregroundStyle("#ffffff"), lineLimit(2)]}>{`${card.headline}: ${card.detail ?? ""}`}</Text>
        ) : null}
        <Text modifiers={[font({ size: card.urgent ? 14 : 16, weight: "regular" }), foregroundStyle(card.broadcast ? "#f4f5f7" : muted), lineLimit(3)]}>{broadcast}</Text>
      </VStack>
    ),
    compactLeading: <Image systemName="dot.radiowaves.left.and.right" color={purple} />,
    compactTrailing: <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle(card.urgent ? purple : "#ffffff")]}>{badge}</Text>,
    minimal: <Image systemName="dot.radiowaves.left.and.right" color={purple} />,
    expandedLeading: (
      <Text modifiers={[font({ size: 14, weight: "semibold" }), foregroundStyle("#ffffff"), lineLimit(1), padding({ leading: 6 })]}>{card.eventName}</Text>
    ),
    expandedTrailing: (
      <Text modifiers={[font({ size: 14, weight: "bold" }), foregroundStyle(purple), padding({ trailing: 6 })]}>{badge}</Text>
    ),
    expandedBottom: (
      <VStack alignment="leading" spacing={4} modifiers={[padding({ horizontal: 6, bottom: 6 })]}>
        {card.urgent ? <Text modifiers={[font({ size: 17, weight: "bold" }), foregroundStyle("#ffffff"), lineLimit(1)]}>{card.detail ?? ""}</Text> : null}
        <Text modifiers={[font({ size: 14 }), foregroundStyle(card.broadcast ? "#f4f5f7" : muted), lineLimit(2)]}>{broadcast}</Text>
      </VStack>
    ),
  };
}

/** iOS only. Creating it registers the layout, so cards started by push can be drawn too. */
export const QronoLiveActivity = Platform.OS === "ios" ? createLiveActivity<LiveCard>(ACTIVITY_NAME, QronoLive) : null;

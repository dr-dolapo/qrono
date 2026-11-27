import { HStack, Image, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  activityBackgroundTint,
  font,
  foregroundStyle,
  lineLimit,
  monospacedDigit,
  padding,
  progressViewStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";
import { Platform } from "react-native";
import type { LiveCard } from "../../modules/qrono-live-updates/src";

/** Must match ACTIVITY_NAME in the API (apps/api/src/live/cards.ts). */
export const ACTIVITY_NAME = "QronoLive";

/**
 * The iOS Live Activity, drawn like the event screen's pushdown: one big countdown and a
 * caption, in the pushdown's colour. Purple by default, amber in the warning window, green
 * while you're on, red once something runs over (it then counts up).
 *
 * The countdown ticks by itself on the Lock Screen; the server sends an update when the
 * colour changes. Apple keeps the Dynamic Island black, so there the colour is in the digits
 * and the ring.
 */
function QronoLive(card: LiveCard, env: LiveActivityEnvironment) {
  "widget";
  // [background, text, caption, accent on black]
  const tones = {
    purple: ["#460976", "#ffffff", "#e2cff5", "#c58cff"],
    amber: ["#f5b301", "#1c1300", "#3d2b00", "#ffc933"],
    green: ["#15803d", "#ffffff", "#d7f5e1", "#4ade80"],
    red: ["#c62828", "#ffffff", "#ffdcdc", "#ff6b6b"],
  };
  const t = tones[card.tone ?? "purple"] ?? tones.purple;
  const bg = t[0];
  const fg = t[1];
  const sub = t[2];
  const accent = t[3];
  const ended = env.isStale;
  // Cards from a server before the pushdown carry only the headline.
  const caption = ended ? "This event has ended" : card.caption ?? (card.urgent ? `${card.headline} · ${card.detail ?? ""}` : card.eventName);
  const now = Date.now();
  const target = !ended && typeof card.target === "number" ? card.target : null;
  const from = typeof card.from === "number" ? Math.min(card.from, now) : now;
  const twelveHours = 12 * 60 * 60 * 1000;

  const big = (size: number, color: string) =>
    target === null ? (
      <Text modifiers={[font({ size: size * 0.6, weight: "heavy" }), foregroundStyle(color), lineLimit(1)]}>{ended ? "Thank you!" : card.text ?? card.headline}</Text>
    ) : card.over ? (
      <HStack spacing={0}>
        <Text modifiers={[font({ size, weight: "heavy" }), foregroundStyle(color)]}>+</Text>
        <Text
          timerInterval={{ lower: new Date(target), upper: new Date(target + twelveHours) }}
          countsDown={false}
          modifiers={[font({ size, weight: "heavy" }), monospacedDigit(), foregroundStyle(color), lineLimit(1)]}
        />
      </HStack>
    ) : (
      <Text
        timerInterval={{ lower: new Date(Math.min(from, target)), upper: new Date(target) }}
        modifiers={[font({ size, weight: "heavy" }), monospacedDigit(), foregroundStyle(color), lineLimit(1)]}
      />
    );

  // How far through the wait (or the item on now): fills as time passes.
  const ring = (color: string) =>
    target !== null && !card.over && typeof card.from === "number" ? (
      <ProgressView
        timerInterval={{ lower: new Date(Math.min(card.from, target)), upper: new Date(target) }}
        countsDown={false}
        modifiers={[progressViewStyle("circular"), tint(color)]}
      />
    ) : (
      <Image systemName={card.over ? "exclamationmark.circle.fill" : "timer"} color={color} />
    );

  const message = card.broadcast ? (
    <Text modifiers={[font({ size: 13 }), foregroundStyle(sub), lineLimit(1)]}>{card.broadcast}</Text>
  ) : null;

  return {
    banner: (
      <VStack alignment="leading" spacing={6} modifiers={[padding({ all: 16 }), activityBackgroundTint(bg)]}>
        <HStack spacing={6}>
          <Image systemName="timer" size={13} color={sub} />
          <Text modifiers={[font({ size: 14, weight: "semibold" }), foregroundStyle(sub), lineLimit(1)]}>{caption}</Text>
          <Spacer />
        </HStack>
        {big(52, fg)}
        {message}
      </VStack>
    ),
    compactLeading: ring(accent),
    compactTrailing: target === null ? <Image systemName="checkmark" color={accent} /> : big(15, accent),
    minimal: ring(accent),
    expandedLeading: (
      <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle("#c9cdd6"), lineLimit(1), padding({ leading: 6 })]}>{caption}</Text>
    ),
    expandedTrailing: ring(accent),
    expandedBottom: (
      <VStack alignment="center" spacing={4} modifiers={[padding({ horizontal: 6, bottom: 6 })]}>
        {big(44, accent)}
        {card.broadcast ? <Text modifiers={[font({ size: 13 }), foregroundStyle("#a3a9b6"), lineLimit(1)]}>{card.broadcast}</Text> : null}
      </VStack>
    ),
  };
}

/** iOS only. Creating it registers the layout, so cards started by push can be drawn too. */
export const QronoLiveActivity = Platform.OS === "ios" ? createLiveActivity<LiveCard>(ACTIVITY_NAME, QronoLive) : null;

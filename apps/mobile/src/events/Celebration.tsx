import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";

const POPPER = require("../../assets/popper.png");
const COLORS = ["#f5b301", "#4ade80", "#b98af5", "#ff6b6b", "#60a5fa", "#ffffff"];
const COUNT = 56;

/** The horn's size, where it sits across the pushdown, and where its mouth is at rest (45°), from its tip. */
export const HORN = { width: 56, height: 70, across: 0.7, bottom: 16, tip: 68, mouthAtRest: { dx: -39, dy: -39 } };
/** One round: up and fire, the confetti falls, a pause. Three rounds, then it stops. */
export const ROUND_MS = 7000;
export const ROUNDS = 3;

/**
 * The confetti horn, hidden behind the black sheet at 70% across, pivoting on its tip: it swings
 * up from pointing left to 45° (up and to the left) as it rises, fires, then swings back down out
 * of sight (rise 0–900ms, hold, back down 1400–2000ms). `still`: at rest, for Reduce Motion.
 */
export function Horn({ still }: { still?: boolean }) {
  const t = useRef(new Animated.Value(still ? 0.45 : 0)).current;
  useEffect(() => {
    if (!still) Animated.timing(t, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: true }).start();
  }, [t, still]);
  // Key moments, as fractions of the 2 seconds (the same as the web's keyframes).
  const at = [0, 0.06, 0.13, 0.2625, 0.35, 0.45, 0.7, 0.8, 0.9, 1];
  return (
    <Animated.Image
      source={POPPER}
      accessibilityIgnoresInvertColors
      style={[
        styles.horn,
        {
          transformOrigin: `50% ${(HORN.tip / HORN.height) * 100}%`,
          transform: [
            { translateY: t.interpolate({ inputRange: at, outputRange: [90, 45, 15, -6, 3, 0, 0, 12, 45, 90] }) },
            { rotate: t.interpolate({ inputRange: at, outputRange: ["-90deg", "-70deg", "-55deg", "-40deg", "-48deg", "-45deg", "-45deg", "-50deg", "-68deg", "-90deg"] }) },
          ],
        },
      ]}
    />
  );
}

/**
 * The spray, drawn in front of everything: the bits rise from the popper's mouth inside the
 * coloured pushdown, then fall over the black sheet too, so the popper looks hidden behind the
 * sheet while its confetti spills out over it. Plays once; skipped when Reduce Motion is on.
 */
export function ConfettiBurst({ x, y, room, fall }: { x: number; y: number; room: number; fall: number }) {
  // Mostly up and to the left, the way the horn points.
  const [done, setDone] = useState(false);
  const bits = useRef(
    Array.from({ length: COUNT }, (_, i) => ({
      rise: new Animated.Value(0),
      drop: new Animated.Value(0),
      dx: -110 + (Math.random() - 0.5) * 300,
      peak: Math.max(100, room) * (0.45 + Math.random() * 0.55),
      fall: fall * (0.45 + Math.random() * 0.5),
      spin: (Math.random() - 0.5) * 1440,
      round: i % 3 === 0,
      color: COLORS[i % COLORS.length]!,
      delay: 380 + Math.random() * 160,
      duration: 2400 + Math.random() * 1200,
    })),
  ).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) return setDone(true);
      Animated.parallel(
        bits.map((b) =>
          Animated.sequence([
            Animated.delay(b.delay),
            Animated.timing(b.rise, { toValue: 1, duration: b.duration * 0.28, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
            Animated.timing(b.drop, { toValue: 1, duration: b.duration * 0.72, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          ]),
        ),
      ).start(() => setDone(true));
    });
    return () => {
      cancelled = true;
    };
  }, [bits]);

  if (done) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {bits.map((b, i) => {
        const w = b.round ? 7 : 6;
        const h = b.round ? 7 : 11;
        return (
          <Animated.View
            key={i}
            style={{
              position: "absolute",
              left: x - w / 2,
              top: y,
              width: w,
              height: h,
              borderRadius: b.round ? 4 : 2,
              backgroundColor: b.color,
              opacity: Animated.add(b.rise.interpolate({ inputRange: [0, 0.01, 1], outputRange: [0, 1, 1] }), b.drop.interpolate({ inputRange: [0, 0.85, 1], outputRange: [0, 0, -1] })),
              transform: [
                { translateX: Animated.add(b.rise.interpolate({ inputRange: [0, 1], outputRange: [0, b.dx * 0.55] }), b.drop.interpolate({ inputRange: [0, 1], outputRange: [0, b.dx * 0.45] })) },
                { translateY: Animated.add(b.rise.interpolate({ inputRange: [0, 1], outputRange: [0, -b.peak] }), b.drop.interpolate({ inputRange: [0, 1], outputRange: [0, b.peak + b.fall] })) },
                { rotate: Animated.add(b.rise, b.drop).interpolate({ inputRange: [0, 2], outputRange: ["0deg", `${b.spin}deg`] }) },
              ],
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  horn: { position: "absolute", left: `${HORN.across * 100}%`, bottom: HORN.bottom, marginLeft: -HORN.width / 2, width: HORN.width, height: HORN.height },
});


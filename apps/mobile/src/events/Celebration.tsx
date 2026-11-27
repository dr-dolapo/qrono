import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";

const POPPER = require("../../assets/popper.png");
const COLORS = ["#f5b301", "#4ade80", "#b98af5", "#ff6b6b", "#60a5fa", "#ffffff"];
const COUNT = 56;

/** The popper's size, and where its mouth is (from its top). */
export const POPPER_SIZE = { width: 56, height: 70, mouth: 14 };

/**
 * Your part is done: a confetti popper pops up from behind the black sheet. It sits in the
 * pushdown under the sheet (only its mouth and top show), with a springy pop when it appears.
 */
export function Popper({ bottom }: { bottom: number }) {
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 70, useNativeDriver: true }).start();
  }, [pop]);
  return (
    <Animated.Image
      source={POPPER}
      accessibilityIgnoresInvertColors
      style={[
        styles.popper,
        {
          bottom,
          transform: [
            { translateX: -POPPER_SIZE.width / 2 },
            { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [90, 0] }) },
            { rotate: pop.interpolate({ inputRange: [0, 0.5, 0.8, 1], outputRange: ["0deg", "-7deg", "5deg", "0deg"] }) },
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
  const [done, setDone] = useState(false);
  const bits = useRef(
    Array.from({ length: COUNT }, (_, i) => ({
      rise: new Animated.Value(0),
      drop: new Animated.Value(0),
      dx: (Math.random() - 0.5) * 340,
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
  popper: { position: "absolute", left: "50%", width: POPPER_SIZE.width, height: POPPER_SIZE.height },
});


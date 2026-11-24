import * as Updates from "expo-updates";
import { useEffect } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, font, radius, space } from "../theme";

/**
 * Over-the-air updates for installed builds. The app checks on launch (built into
 * expo-updates) and whenever it comes back to the foreground, downloads in the
 * background, then offers a restart. Nothing shows in Expo Go or development.
 */
export function UpdateBanner() {
  const { isUpdatePending } = Updates.useUpdates();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!Updates.isEnabled || __DEV__) return;
    const check = async () => {
      try {
        const { isAvailable } = await Updates.checkForUpdateAsync();
        if (isAvailable) await Updates.fetchUpdateAsync();
      } catch {
        // Offline, or the update server is unreachable: try again next time.
      }
    };
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => sub.remove();
  }, []);

  if (!isUpdatePending) return null;
  return (
    <View style={[styles.wrap, { bottom: insets.bottom + space.md }]} pointerEvents="box-none">
      <View style={styles.banner} accessibilityRole="alert">
        <Text style={styles.text}>A new version of Qrono is ready.</Text>
        <Pressable
          onPress={() => void Updates.reloadAsync()}
          accessibilityRole="button"
          accessibilityHint="Restarts the app with the new version"
          style={({ pressed }) => [styles.button, pressed && { opacity: 0.75 }]}
        >
          <Text style={styles.buttonText}>Restart</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: space.lg, right: space.lg },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.surface,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: space.sm,
    paddingLeft: space.lg,
    paddingRight: space.sm,
  },
  text: { color: colors.text, fontSize: 14, ...font("400"), flex: 1 },
  button: { backgroundColor: colors.accent, borderRadius: radius.md, minHeight: 44, paddingHorizontal: space.lg, justifyContent: "center" },
  buttonText: { color: colors.onAccent, fontSize: 15, ...font("700") },
});

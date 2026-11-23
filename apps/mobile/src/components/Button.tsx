import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { colors, radius, space } from "../theme";

interface Props {
  label: string;
  onPress(): void;
  variant?: "primary" | "secondary" | "link";
  busy?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}

export function Button({ label, onPress, variant = "primary", busy = false, disabled = false, accessibilityHint }: Props) {
  const inactive = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole={variant === "link" ? "link" : "button"}
      accessibilityState={{ disabled: inactive, busy }}
      accessibilityHint={accessibilityHint}
      hitSlop={variant === "link" ? 8 : 0}
      style={({ pressed }) => [
        styles.base,
        variant === "primary" && styles.primary,
        variant === "secondary" && styles.secondary,
        variant === "link" && styles.link,
        (pressed || inactive) && styles.dimmed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === "primary" ? colors.onAccent : colors.text} />
      ) : (
        <Text style={[styles.label, variant === "primary" ? styles.primaryLabel : variant === "link" ? styles.linkLabel : null]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: space.lg },
  primary: { backgroundColor: colors.accent },
  secondary: { borderWidth: 1, borderColor: colors.border },
  link: { minHeight: 44, paddingHorizontal: 0 },
  dimmed: { opacity: 0.6 },
  label: { color: colors.text, fontSize: 16, fontWeight: "600" },
  primaryLabel: { color: colors.onAccent },
  linkLabel: { color: colors.accent },
});

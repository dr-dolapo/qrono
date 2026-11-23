import { useState } from "react";
import type { Ref } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { TextInputInstance, TextInputProps } from "react-native";
import { colors, radius, space } from "../theme";

interface Props extends Omit<TextInputProps, "ref"> {
  ref?: Ref<TextInputInstance>;
  label: string;
  error?: string;
  /** Adds a Show / Hide toggle for passwords. */
  secret?: boolean;
}

export function TextField({ ref, label, error, secret, style, ...input }: Props) {
  const [hidden, setHidden] = useState(true);
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.box, error ? styles.boxError : null]}>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.muted}
          selectionColor={colors.accent}
          secureTextEntry={secret && hidden}
          style={[styles.input, style]}
          {...input}
        />
        {secret ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            accessibilityRole="button"
            accessibilityLabel={hidden ? "Show password" : "Hide password"}
            hitSlop={8}
            style={styles.toggle}
          >
            <Text style={styles.toggleText}>{hidden ? "Show" : "Hide"}</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  label: { color: colors.text, fontSize: 14, fontWeight: "600" },
  box: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  boxError: { borderColor: colors.danger },
  input: { flex: 1, color: colors.text, fontSize: 16, paddingHorizontal: space.md, paddingVertical: space.md },
  toggle: { paddingHorizontal: space.md, minHeight: 44, justifyContent: "center" },
  toggleText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  error: { color: colors.danger, fontSize: 13 },
});

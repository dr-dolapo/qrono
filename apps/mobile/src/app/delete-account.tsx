import { router } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../auth/AuthProvider";
import { ApiError, api } from "../lib/api";
import { colors, font, radius, space } from "../theme";

/**
 * Profile → Delete account. Asks for the password, then deletes for good (App Store 5.1.1(v)).
 * If they're the last Admin of a team with other people, the server says which team to hand over first.
 */
export default function DeleteAccount() {
  const { user, logOut } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    Alert.alert("Delete your account?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void remove() },
    ]);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/me/delete", { body: { password } });
      await logOut();
      Alert.alert("Account deleted", "Your Qrono account and personal details have been deleted.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back} accessibilityRole="button" accessibilityLabel="Back to Profile">
            <Text style={styles.backText}>‹ Profile</Text>
          </Pressable>
          <Text style={styles.title} accessibilityRole="header">
            Delete account
          </Text>

          <View style={styles.card}>
            <Text style={styles.label}>What happens</Text>
            {[
              "Your name, email and password are deleted, and you're logged out everywhere.",
              "You leave all your teams. Teams where you're the only member are deleted with their events.",
              "Programs you worked on stay with their teams, showing “Deleted user” where your name was.",
              "Your Inbox, Archived list and notification settings are deleted.",
            ].map((line) => (
              <View key={line} style={styles.point}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.body}>{line}</Text>
              </View>
            ))}
            <Text style={styles.body}>If you're the only Admin of a team with other people, make someone else an Admin first.</Text>
          </View>

          <View style={{ gap: space.sm }}>
            <Text style={styles.label} nativeID="pw-label">
              Your password
            </Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              placeholder={`Password for ${user?.email ?? "your account"}`}
              placeholderTextColor="#6b6e78"
              style={styles.input}
              accessibilityLabelledBy="pw-label"
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>

          <Pressable
            onPress={confirm}
            disabled={busy || password.length === 0}
            style={({ pressed }) => [styles.delete, (busy || password.length === 0) && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
          >
            <Text style={styles.deleteText}>{busy ? "Deleting…" : "Delete my account"}</Text>
          </Pressable>
          <Text style={styles.note}>Questions? Email support@qrono.co.uk.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  content: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.xxl, gap: space.lg },
  back: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", marginLeft: -2 },
  backText: { color: "#c48cff", fontSize: 17, ...font("500") },
  title: { color: colors.text, fontSize: 30, ...font("800") },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.sm },
  label: { color: colors.text, fontSize: 15, ...font("600") },
  point: { flexDirection: "row", gap: space.sm },
  bullet: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  body: { flex: 1, color: colors.muted, fontSize: 14, lineHeight: 20, ...font("400") },
  input: { minHeight: 48, borderRadius: radius.md, backgroundColor: "#17181d", color: colors.text, paddingHorizontal: space.md, fontSize: 16, ...font("400") },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20, ...font("400") },
  delete: { minHeight: 50, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.danger },
  deleteText: { color: colors.danger, fontSize: 16, ...font("700") },
  note: { color: colors.muted, fontSize: 13, textAlign: "center", ...font("400") },
});

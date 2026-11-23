import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../components/Button";
import { Screen } from "../components/Screen";
import { TextField } from "../components/TextField";
import { ApiError, api } from "../lib/api";
import { colors, space } from "../theme";

/** QR005: ask for a reset link. The link opens the web page where the new password is set. */
export default function ForgotPassword() {
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit() {
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api("/auth/forgot-password", { body: { email: email.trim() } });
      setSentTo(email.trim());
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.email ?? err.message) : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <Screen>
        <Text style={styles.title} accessibilityRole="header">
          Check your email
        </Text>
        <Text style={styles.body}>
          If there's a Qrono account for {sentTo}, we've sent it a link to set a new password. The link works for one
          hour.
        </Text>
        <Text style={styles.body}>Open it on this phone or on a computer, then come back here and log in.</Text>
        <Button label="Back to log in" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.body}>Enter the email you use for Qrono and we'll send you a link to set a new password.</Text>
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={error}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="username"
        returnKeyType="send"
        onSubmitEditing={submit}
      />
      <View style={styles.actions}>
        <Button label="Send reset link" onPress={submit} busy={busy} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 24, fontWeight: "700" },
  body: { color: colors.muted, fontSize: 16, lineHeight: 23 },
  actions: { marginTop: space.sm },
});

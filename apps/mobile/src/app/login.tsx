import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useRef, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import type { TextInputInstance } from "react-native";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/Button";
import { Screen } from "../components/Screen";
import { TextField } from "../components/TextField";
import { webUrl } from "../config";
import { ApiError } from "../lib/api";
import { colors, space } from "../theme";

/** QR004 log in, with links to reset a password (QR005) and to sign up on the web (QR043). */
export default function LogIn() {
  const { logIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInputInstance>(null);

  async function submit() {
    const next: typeof errors = {};
    if (!email.trim()) next.email = "Enter your email address.";
    if (!password) next.password = "Enter your password.";
    setErrors(next);
    if (next.email || next.password) return;

    setBusy(true);
    try {
      await logIn(email, password);
      // The navigator switches to the signed-in screens by itself.
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors({ email: err.fields.email, password: err.fields.password, form: err.message });
      } else {
        setErrors({ form: "Something went wrong. Please try again." });
      }
      setBusy(false);
    }
  }

  return (
    <Screen centered>
      <View style={styles.brand}>
        <Image source={require("../../assets/splash-icon.png")} style={styles.mark} accessibilityIgnoresInvertColors />
        <Text style={styles.title} accessibilityRole="header">
          Log in to Qrono
        </Text>
      </View>

      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="username"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        submitBehavior="submit"
      />
      <TextField
        ref={passwordRef}
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        secret
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      {errors.form ? (
        <Text style={styles.formError} accessibilityLiveRegion="polite">
          {errors.form}
        </Text>
      ) : null}

      <Button label="Log in" onPress={submit} busy={busy} />
      <Button
        label="Forgot your password?"
        variant="link"
        onPress={() => router.push({ pathname: "/forgot-password", params: email.trim() ? { email: email.trim() } : {} })}
      />

      <View style={styles.signup}>
        <Text style={styles.muted}>New to Qrono? Accounts are created on the web.</Text>
        <Button
          label="Create an account"
          variant="secondary"
          onPress={() => void WebBrowser.openBrowserAsync(webUrl("/signup"))}
          accessibilityHint="Opens the Qrono sign-up page in your browser"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: "center", gap: space.md, marginBottom: space.md },
  mark: { width: 96, height: 96 },
  title: { color: colors.text, fontSize: 26, fontWeight: "700" },
  formError: { color: colors.danger, fontSize: 14 },
  signup: { marginTop: space.xl, gap: space.sm, alignItems: "stretch" },
  muted: { color: colors.muted, fontSize: 14, textAlign: "center" },
});

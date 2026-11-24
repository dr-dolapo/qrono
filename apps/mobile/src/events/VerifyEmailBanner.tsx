import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/Button";
import { ApiError, api } from "../lib/api";
import { colors, font, radius, space } from "../theme";

/** QR003: the account works, but events wait until the email is confirmed. */
export function VerifyEmailBanner({ email, onConfirmed }: { email: string; onConfirmed(): Promise<void> }) {
  const { refreshUser } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function resend() {
    setBusy(true);
    try {
      const res = await api<{ sent?: boolean; alreadyVerified?: boolean }>("/auth/resend-verification", { method: "POST" });
      if (res.alreadyVerified) {
        await refreshUser();
        await onConfirmed();
      } else setMessage(`New link sent to ${email}.`);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Couldn't send the email. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function checkAgain() {
    setBusy(true);
    try {
      await refreshUser();
      await onConfirmed();
    } catch {
      setMessage("Couldn't check right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.bannerTitle}>Confirm your email</Text>
      <Text style={styles.bannerBody}>
        We sent a link to {email}. Open it to finish setting up your account and see your events, then tap "I've confirmed it".
      </Text>
      {message ? <Text style={styles.bannerBody}>{message}</Text> : null}
      <View style={styles.bannerActions}>
        <Button label="I've confirmed it" onPress={checkAgain} busy={busy} />
        <Button label="Send a new link" variant="link" onPress={resend} disabled={busy} />
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  banner: { backgroundColor: colors.warningSurface, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  bannerTitle: { color: colors.warningText, fontSize: 16, ...font("700") },
  bannerBody: { color: colors.text, fontSize: 14, ...font("400"), lineHeight: 20 },
  bannerActions: { gap: space.xs, marginTop: space.xs },
});

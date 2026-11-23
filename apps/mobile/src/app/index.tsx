import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/Button";
import { Screen } from "../components/Screen";
import { ApiError, api } from "../lib/api";
import { colors, radius, space } from "../theme";

/** Home: the signed-in user's events (filled in by the next step). */
export default function Home() {
  const { user, logOut } = useAuth();

  function confirmLogOut() {
    Alert.alert("Log out of Qrono?", "You'll stop getting broadcasts on this phone until you log in again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: () => void logOut() },
    ]);
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.brand} accessibilityRole="header">
          Qrono
        </Text>
        <Text style={styles.muted}>Signed in as {user?.firstName ?? "you"}</Text>
      </View>

      {user && !user.emailVerified ? <VerifyEmailBanner email={user.email} /> : null}

      <Text style={styles.sectionTitle}>My events</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>No events yet</Text>
        <Text style={styles.cardBody}>
          Events you're assigned to will appear here, with your tasks and a countdown to the start.
        </Text>
      </View>

      <View style={styles.footer}>
        <Button label="Log out" variant="secondary" onPress={confirmLogOut} />
      </View>
    </Screen>
  );
}

/** QR003: the account works, but most of Qrono waits until the email is confirmed. */
function VerifyEmailBanner({ email }: { email: string }) {
  const { refreshUser } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function resend() {
    setBusy(true);
    try {
      const res = await api<{ sent?: boolean; alreadyVerified?: boolean }>("/auth/resend-verification", { method: "POST" });
      if (res.alreadyVerified) await refreshUser();
      else setMessage(`New link sent to ${email}.`);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Couldn't send the email. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function checkAgain() {
    setBusy(true);
    await refreshUser().catch(() => setMessage("Couldn't check right now. Please try again."));
    setBusy(false);
  }

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.bannerTitle}>Confirm your email</Text>
      <Text style={styles.bannerBody}>
        We sent a link to {email}. Open it to finish setting up your account, then tap "I've confirmed it".
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
  header: { gap: space.xs },
  brand: { color: colors.text, fontSize: 28, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 14 },
  sectionTitle: { color: colors.text, fontSize: 22, fontWeight: "600", marginTop: space.sm },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: 6,
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  cardBody: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  banner: { backgroundColor: colors.warningSurface, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  bannerTitle: { color: colors.warningText, fontSize: 16, fontWeight: "700" },
  bannerBody: { color: colors.text, fontSize: 14, lineHeight: 20 },
  bannerActions: { gap: space.xs, marginTop: space.xs },
  footer: { marginTop: "auto", paddingTop: space.xl },
});

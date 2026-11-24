import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/Button";
import { EventCard } from "../events/EventCard";
import type { MyEvent } from "../events/types";
import { ApiError, api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useNow } from "../lib/useNow";
import { colors, font, radius, space } from "../theme";

const PAST_SHOWN = 10;

/** QR018 / QR023: every event I'm part of, across my teams. */
export default function Home() {
  const { user } = useAuth();
  const { data, error, loading, refreshing, refresh } = useApi<{ events: MyEvent[] }>("/me/events");
  const now = useNow(30_000);

  const sections = useMemo(() => {
    const events = data?.events ?? [];
    const ended = (e: MyEvent) => e.status === "past" || Date.parse(e.endAt) <= now;
    const approval = events.filter((e) => e.awaitingMyApproval);
    const live = events.filter((e) => !e.awaitingMyApproval && e.status === "live");
    const upcoming = events.filter((e) => !e.awaitingMyApproval && e.status !== "live" && !ended(e));
    const past = events.filter((e) => !e.awaitingMyApproval && e.status !== "live" && ended(e)).reverse().slice(0, PAST_SHOWN);
    return [
      { title: "Waiting for your approval", data: approval },
      { title: "Live now", data: live },
      { title: "Coming up", data: upcoming },
      { title: "Past", data: past },
    ].filter((s) => s.data.length > 0);
  }, [data, now]);

  const unverified = user && !user.emailVerified;
  const blockedByEmail = error?.code === "email_unverified";

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <SectionList
        sections={sections}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => <EventCard event={item} now={now} />}
        renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.brand} accessibilityRole="header">
              My events
            </Text>
            {unverified || blockedByEmail ? <VerifyEmailBanner email={user?.email ?? "your email"} onConfirmed={refresh} /> : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.muted} style={{ marginTop: space.xxl }} />
          ) : blockedByEmail ? undefined : error ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Couldn't load your events</Text>
              <Text style={styles.cardBody}>{error.message}</Text>
              <Button label="Try again" variant="secondary" onPress={refresh} />
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>No events yet</Text>
              <Text style={styles.cardBody}>
                When you're added to an event, it shows up here with your tasks and a countdown to the start. Pull down to
                refresh.
              </Text>
            </View>
          )
        }
        ListFooterComponent={<AccountFooter />}
      />
    </SafeAreaView>
  );
}

function AccountFooter() {
  const { user, logOut } = useAuth();
  function confirmLogOut() {
    Alert.alert("Log out of Qrono?", "You'll stop getting broadcasts on this phone until you log in again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: () => void logOut() },
    ]);
  }
  return (
    <View style={styles.footer}>
      <Text style={styles.muted}>
        Signed in as {user?.firstName} {user?.lastName} ({user?.email})
      </Text>
      <Button label="Settings" variant="secondary" onPress={() => router.push("/settings")} />
      <Button label="Log out" variant="secondary" onPress={confirmLogOut} />
    </View>
  );
}

/** QR003: the account works, but events wait until the email is confirmed. */
function VerifyEmailBanner({ email, onConfirmed }: { email: string; onConfirmed(): Promise<void> }) {
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
  safe: { flex: 1, backgroundColor: "transparent" },
  content: { padding: space.xl, paddingBottom: space.xxl, flexGrow: 1 },
  header: { gap: space.lg, marginBottom: space.sm },
  brand: { color: colors.text, fontSize: 30, ...font("800") },
  sectionTitle: { color: colors.muted, fontSize: 13, ...font("700"), letterSpacing: 0.6, textTransform: "uppercase", marginTop: space.xl, marginBottom: space.md },
  muted: { color: colors.muted, fontSize: 13 , ...font("400")},
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
    marginTop: space.lg,
  },
  cardTitle: { color: colors.text, fontSize: 16, ...font("600") },
  cardBody: { color: colors.muted, fontSize: 14, ...font("400"), lineHeight: 20 },
  banner: { backgroundColor: colors.warningSurface, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  bannerTitle: { color: colors.warningText, fontSize: 16, ...font("700") },
  bannerBody: { color: colors.text, fontSize: 14, ...font("400"), lineHeight: 20 },
  bannerActions: { gap: space.xs, marginTop: space.xs },
  footer: { marginTop: space.xxl, gap: space.md },
});

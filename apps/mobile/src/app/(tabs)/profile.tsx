import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import * as Updates from "expo-updates";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, AppState, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LiveUpdates } from "../../../modules/qrono-live-updates/src";
import { useAuth } from "../../auth/AuthProvider";
import { Button } from "../../components/Button";
import { ApiError, api } from "../../lib/api";
import { colors, font, radius, space } from "../../theme";

type Role = "approver" | "admin" | "member";
interface TeamRow {
  id: string;
  name: string;
  role: Role;
  status: string;
}
interface MySettings {
  me: { reminderEmails: boolean };
  remindersEnabled: boolean;
}
/** The public site: Terms, Privacy Policy and Support. */
const SITE = "https://qrono.co.uk";
const ROLE_LABEL: Record<Role, string> = { approver: "Admin", admin: "Planner", member: "Member" };

/** You: your name, your teams and roles, notifications, and the app itself. */
export default function Profile() {
  const { user, logOut } = useAuth();
  const [teams, setTeams] = useState<(TeamRow & Partial<MySettings>)[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { teams: list } = await api<{ teams: TeamRow[] }>("/teams");
      const rows = await Promise.all(
        list.map(async (t) => (t.status === "active" ? { ...t, ...(await api<MySettings>(`/teams/${t.id}/settings`).catch(() => ({}))) } : t)),
      );
      setTeams(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load your teams.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function setReminders(teamId: string, reminderEmails: boolean) {
    const flip = (v: boolean) => setTeams((list) => list?.map((t) => (t.id === teamId ? { ...t, me: { reminderEmails: v } } : t)) ?? null);
    flip(reminderEmails);
    try {
      await api(`/teams/${teamId}/settings/me`, { method: "PATCH", body: { reminderEmails } });
    } catch {
      flip(!reminderEmails);
      Alert.alert("Couldn't save that", "Check your connection and try again.");
    }
  }

  function confirmLogOut() {
    Alert.alert("Log out of Qrono?", "You'll stop getting notifications on this phone until you log in again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: () => void logOut() },
    ]);
  }

  if (!user) return null;
  const initials = `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          Profile
        </Text>

        <View style={styles.identity}>
          <View style={styles.avatar} accessibilityElementsHidden>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>
              {user.firstName} {user.lastName}
            </Text>
            <Text style={styles.muted}>{user.email}</Text>
          </View>
        </View>
        <NameEditor />
        <Text style={styles.hint}>To change your email or password, use Qrono on the web.</Text>

        <Text style={styles.section}>Teams</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!teams && !error ? <ActivityIndicator color={colors.muted} /> : null}
        {teams?.length === 0 ? <Text style={styles.muted}>You're not on a team yet.</Text> : null}
        {teams?.map((t) => (
          <View key={t.id} style={styles.card}>
            <View style={styles.row}>
              <Text style={[styles.label, { flex: 1 }]} numberOfLines={1}>
                {t.name}
              </Text>
              <View style={[styles.pill, t.status !== "active" && styles.pillWaiting]}>
                <Text style={styles.pillText}>{t.status === "active" ? ROLE_LABEL[t.role] : "Waiting to be let in"}</Text>
              </View>
            </View>
            {t.me ? (
              <View style={styles.row}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.label}>Reminder emails</Text>
                  <Text style={styles.hint}>
                    {t.remindersEnabled ? "Before events you're on, at the times your team has chosen." : "Your team has turned reminders off for now."}
                  </Text>
                </View>
                <Switch
                  value={t.me.reminderEmails}
                  onValueChange={(v) => setReminders(t.id, v)}
                  trackColor={{ true: colors.accent, false: colors.border }}
                  thumbColor="#ffffff"
                  accessibilityLabel={`Reminder emails for ${t.name}`}
                />
              </View>
            ) : null}
          </View>
        ))}

        <Text style={styles.section}>Notifications</Text>
        <PushStatus />

        <Text style={styles.section}>App</Text>
        <AppInfo />

        <View style={styles.legal}>
          <Pressable onPress={() => void WebBrowser.openBrowserAsync(`${SITE}/privacy`)} hitSlop={8} accessibilityRole="link">
            <Text style={styles.link}>Privacy Policy</Text>
          </Pressable>
          <Text style={styles.muted}>·</Text>
          <Pressable onPress={() => void WebBrowser.openBrowserAsync(`${SITE}/terms`)} hitSlop={8} accessibilityRole="link">
            <Text style={styles.link}>Terms</Text>
          </Pressable>
          <Text style={styles.muted}>·</Text>
          <Pressable onPress={() => void WebBrowser.openBrowserAsync(`${SITE}/support`)} hitSlop={8} accessibilityRole="link">
            <Text style={styles.link}>Support</Text>
          </Pressable>
        </View>

        <View style={{ marginTop: space.lg }}>
          <Button label="Log out" variant="secondary" onPress={confirmLogOut} />
        </View>
        <Pressable onPress={() => router.push("/delete-account")} style={styles.deleteLink} accessibilityRole="button">
          <Text style={styles.deleteText}>Delete account</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function NameEditor() {
  const { user, refreshUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [first, setFirst] = useState(user?.firstName ?? "");
  const [last, setLast] = useState(user?.lastName ?? "");
  const [saving, setSaving] = useState(false);

  if (!editing)
    return (
      <Pressable
        onPress={() => {
          setFirst(user?.firstName ?? "");
          setLast(user?.lastName ?? "");
          setEditing(true);
        }}
        style={styles.editLink}
        accessibilityRole="button"
      >
        <Text style={styles.link}>Edit name</Text>
      </Pressable>
    );

  async function save() {
    setSaving(true);
    try {
      await api("/auth/me", { method: "PATCH", body: { firstName: first.trim(), lastName: last.trim() } });
      await refreshUser();
      setEditing(false);
    } catch (err) {
      Alert.alert("Couldn't save your name", err instanceof ApiError ? err.message : "Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.card}>
      <TextInput value={first} onChangeText={setFirst} placeholder="First name" placeholderTextColor="#6b6e78" style={styles.input} autoFocus maxLength={60} textContentType="givenName" />
      <TextInput value={last} onChangeText={setLast} placeholder="Last name" placeholderTextColor="#6b6e78" style={styles.input} maxLength={60} textContentType="familyName" />
      <View style={[styles.row, { justifyContent: "flex-end" }]}>
        <Button label="Cancel" variant="link" onPress={() => setEditing(false)} />
        <Button label={saving ? "Saving…" : "Save"} onPress={save} disabled={saving || !first.trim() || !last.trim()} />
      </View>
    </View>
  );
}

function PushStatus() {
  const [status, setStatus] = useState<string | null>(null);
  const check = useCallback(() => {
    Notifications.getPermissionsAsync()
      .then((p) => setStatus(p.status))
      .catch(() => setStatus("unknown"));
  }, []);
  useEffect(() => {
    check();
    const sub = AppState.addEventListener("change", (s) => s === "active" && check());
    return () => sub.remove();
  }, [check]);

  const on = status === "granted";
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.label}>Push notifications</Text>
          <Text style={styles.hint}>
            {on ? "On. Approvals, new parts and broadcasts reach this phone." : "Off. Turn them on so urgent things reach you without opening the app."}
          </Text>
        </View>
        <Text style={[styles.state, on && styles.stateOn]}>{status === null ? "" : on ? "On" : "Off"}</Text>
      </View>
      <Button label="Open phone settings" variant="secondary" onPress={() => void Linking.openSettings()} />
      {LiveUpdates.available && on && !LiveUpdates.canPromote() ? (
        <View style={{ gap: space.sm }}>
          <Text style={styles.hint}>
            Live Updates are off, so the card for a live event stays in your notifications instead of the status bar and lock screen.
          </Text>
          <Button label="Turn on Live Updates" variant="secondary" onPress={() => LiveUpdates.openSettings()} />
        </View>
      ) : null}
    </View>
  );
}

function AppInfo() {
  const [checking, setChecking] = useState(false);
  const version = Constants.expoConfig?.version ?? "—";
  const updateId = Updates.updateId ? Updates.updateId.slice(0, 8) : "built-in";

  async function checkForUpdate() {
    if (!Updates.isEnabled || __DEV__) return Alert.alert("Updates", "Updates aren't available in this build.");
    setChecking(true);
    try {
      const { isAvailable } = await Updates.checkForUpdateAsync();
      if (!isAvailable) return Alert.alert("You're up to date", "This is the latest version of Qrono.");
      await Updates.fetchUpdateAsync();
      Alert.alert("Update ready", "Restart Qrono to use the new version.", [
        { text: "Later", style: "cancel" },
        { text: "Restart", onPress: () => void Updates.reloadAsync() },
      ]);
    } catch {
      Alert.alert("Couldn't check for updates", "Check your connection and try again.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={[styles.label, { flex: 1 }]}>Version</Text>
        <Text style={styles.muted}>
          {version} · {updateId}
        </Text>
      </View>
      <Button label={checking ? "Checking…" : "Check for updates"} variant="secondary" onPress={checkForUpdate} disabled={checking} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  content: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.xxl, gap: space.md },
  title: { color: colors.text, fontSize: 30, ...font("800"), marginBottom: space.sm },
  identity: { flexDirection: "row", alignItems: "center", gap: space.lg },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#3b1f63", borderWidth: 1, borderColor: "rgba(185,138,245,0.5)", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#e9dbff", fontSize: 22, ...font("700") },
  name: { color: colors.text, fontSize: 20, ...font("700") },
  muted: { color: colors.muted, fontSize: 14, ...font("400") },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18, ...font("400") },
  editLink: { alignSelf: "flex-start", paddingVertical: 2 },
  link: { color: "#c48cff", fontSize: 14, ...font("600") },
  section: { color: colors.muted, fontSize: 13, ...font("700"), letterSpacing: 0.6, textTransform: "uppercase", marginTop: space.lg },
  error: { color: colors.danger, fontSize: 14, ...font("400") },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  label: { color: colors.text, fontSize: 15, ...font("500") },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: "rgba(185,138,245,0.16)" },
  pillWaiting: { backgroundColor: "rgba(255,255,255,0.08)" },
  pillText: { color: "#d8c2fb", fontSize: 12, ...font("600") },
  input: { minHeight: 44, borderRadius: radius.md, backgroundColor: "#17181d", color: colors.text, paddingHorizontal: space.md, fontSize: 15, ...font("400") },
  state: { color: colors.muted, fontSize: 14, ...font("600") },
  legal: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm, marginTop: space.md },
  deleteLink: { alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: space.md },
  deleteText: { color: colors.danger, fontSize: 15, ...font("600") },
  stateOn: { color: "#7ee2a8" },
});

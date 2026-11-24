import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { ApiError, api } from "../lib/api";
import { colors, font, radius, space } from "../theme";

interface TeamRow {
  id: string;
  name: string;
  status: string;
}
interface MySettings {
  me: { reminderEmails: boolean };
  remindersEnabled: boolean;
}

/** Your own settings, per team: reminder emails on or off. Team-wide settings are on the web, for Admins. */
export default function Settings() {
  const [teams, setTeams] = useState<(TeamRow & MySettings)[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { teams: list } = await api<{ teams: TeamRow[] }>("/teams");
      const active = list.filter((t) => t.status === "active");
      const rows = await Promise.all(active.map(async (t) => ({ ...t, ...(await api<MySettings>(`/teams/${t.id}/settings`)) })));
      setTeams(rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load your settings.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function setReminders(teamId: string, reminderEmails: boolean) {
    setTeams((list) => list?.map((t) => (t.id === teamId ? { ...t, me: { reminderEmails } } : t)) ?? null);
    try {
      await api(`/teams/${teamId}/settings/me`, { method: "PATCH", body: { reminderEmails } });
    } catch {
      // Put it back if it didn't save.
      setTeams((list) => list?.map((t) => (t.id === teamId ? { ...t, me: { reminderEmails: !reminderEmails } } : t)) ?? null);
      setError("Couldn't save that. Check your connection and try again.");
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title} accessibilityRole="header">
        Settings
      </Text>
      <Text style={styles.lead}>These are just for you. Nobody else sees or changes them.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!teams && !error ? <ActivityIndicator color={colors.muted} style={{ marginTop: space.xl }} /> : null}
      {teams?.map((t) => (
        <View key={t.id} style={styles.card}>
          <Text style={styles.team}>{t.name}</Text>
          <View style={styles.row}>
            <View style={styles.rowText}>
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
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md, backgroundColor: "transparent" },
  title: { color: colors.text, fontSize: 28, ...font("700") },
  lead: { color: colors.muted, fontSize: 15, ...font("400"), marginBottom: space.sm },
  error: { color: colors.danger, fontSize: 14, ...font("400") },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.md },
  team: { color: colors.text, fontSize: 16, ...font("600") },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  rowText: { flex: 1, gap: 2 },
  label: { color: colors.text, fontSize: 15, ...font("500") },
  hint: { color: colors.muted, fontSize: 13, ...font("400") },
});

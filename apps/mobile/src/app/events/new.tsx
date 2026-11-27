import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { addDays, dayKey } from "../../calendar/dates";
import { TextField } from "../../components/TextField";
import { ApiError, api } from "../../lib/api";
import { fromZoned } from "../../lib/time";
import { WhenPicker } from "../../program/WhenPicker";
import { colors, font } from "../../theme";

interface Team {
  id: string;
  name: string;
  timezone: string;
  clockFormat: "12h" | "24h";
  role: "approver" | "admin" | "member";
  status: string;
}

/**
 * Admins and Planners start a program from the + on the Events tab: a name, a date and a
 * start time. Then straight into the program builder, where the items can be just titles.
 */
export default function NewProgram() {
  // The day chosen on the Events tab, or tomorrow.
  const params = useLocalSearchParams<{ day?: string }>();
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [day, setDay] = useState(() => (params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : dayKey(addDays(new Date(), 1))));
  const [minutes, setMinutes] = useState(9 * 60);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ teams: Team[] }>("/teams")
      .then(({ teams: all }) => {
        const mine = all.filter((t) => t.status === "active" && (t.role === "approver" || t.role === "admin"));
        setTeams(mine);
        setTeamId((id) => id ?? mine[0]?.id ?? null);
      })
      .catch(() => setError("Couldn't load your teams. Check your connection."));
  }, []);
  const team = teams.find((t) => t.id === teamId) ?? null;

  async function create() {
    if (!team) return;
    if (!name.trim()) return setErrors({ name: "Give the program a name." });
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      const { event } = await api<{ event: { id: string } }>(`/teams/${encodeURIComponent(team.id)}/events`, {
        body: { name: name.trim(), startAt: fromZoned(day, minutes, team.timezone) },
      });
      router.replace({ pathname: "/events/[id]", params: { id: event.id, team: team.name } });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setError(err.fields.startAt ?? (Object.keys(err.fields).length ? null : err.message));
      } else setError("Couldn't create the program. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8} style={styles.headerSide}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">
          New program
        </Text>
        <View style={[styles.headerSide, { alignItems: "flex-end" }]}>
          <Pressable onPress={create} disabled={busy || !team} accessibilityRole="button" style={({ pressed }) => [styles.create, (busy || !team) && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}>
            <Text style={styles.createText}>{busy ? "Creating…" : "Create"}</Text>
          </Pressable>
        </View>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <TextField label="Name" value={name} onChangeText={setName} placeholder="Sunday Service" error={errors.name} autoFocus returnKeyType="done" maxLength={120} />
          {teams.length > 1 ? (
            <View style={{ gap: 8 }}>
              <Text style={styles.label}>Team</Text>
              <View style={styles.chips}>
                {teams.map((t) => (
                  <Pressable
                    key={t.id}
                    onPress={() => setTeamId(t.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: t.id === teamId }}
                    style={[styles.chip, t.id === teamId && styles.chipOn]}
                  >
                    <Text style={[styles.chipText, t.id === teamId && { color: "#fff" }]}>{t.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          <WhenPicker day={day} minutes={minutes} onChange={(d, m) => (setDay(d), setMinutes(m))} clock={team?.clockFormat} />
          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Text style={styles.hint}>
            Next you’ll list what’s on the program. Timing and people can come later; they’re needed before it’s sent out.
            {team && team.timezone ? ` Times are in ${team.name}’s time zone.` : ""}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8 },
  headerSide: { width: 96 },
  cancel: { color: colors.text, fontSize: 16, ...font("500") },
  headerTitle: { flex: 1, textAlign: "center", color: colors.text, fontSize: 17, ...font("700") },
  create: { height: 36, paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.accent, justifyContent: "center" },
  createText: { color: "#fff", fontSize: 15, ...font("700") },
  body: { padding: 20, gap: 20 },
  label: { color: colors.muted, fontSize: 13, ...font("600") },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { height: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border, justifyContent: "center", backgroundColor: "#16171d" },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 14, ...font("600") },
  error: { color: colors.danger, fontSize: 14, ...font("500") },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 19, ...font("400") },
});

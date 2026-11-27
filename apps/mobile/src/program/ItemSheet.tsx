import { useEffect, useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { EventDetail } from "../events/types";
import { colors, font } from "../theme";
import { keysFor, personKey, whoRef, type TeamPerson } from "./people";

type Task = EventDetail["tasks"][number];

/** The lengths an item can have (the same list as the web and the API). */
const QUICK = [5, 10, 15, 20, 30, 45, 60, 90];
const ALL = [...Array.from({ length: 15 }, (_, i) => i + 1), ...Array.from({ length: 9 }, (_, i) => 20 + i * 5), 75, 90, 105, 120];

export interface ItemChanges {
  title: string;
  durationMinutes: number | null;
  stageId: string | null;
  who: TeamPerson[];
}

/**
 * One item, in a sheet: its title, its length (quick chips, or none yet) and who runs it
 * (the team's people, or a new guest). In a draft, length and who can stay empty for now.
 * Saved when it closes ("Done", a swipe down or tapping outside).
 */
export function ItemSheet(props: {
  detail: EventDetail;
  task: Task | null;
  people: TeamPerson[];
  /** Someone else with this item open, e.g. "Ada". */
  alsoEditing: string | null;
  onAddGuest(name: string, email: string | null): Promise<TeamPerson>;
  onSave(changes: ItemChanges): Promise<void>;
  onDelete(): Promise<void>;
  onClose(): void;
}) {
  const { detail, task, people } = props;
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState("");
  const [length, setLength] = useState<number | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [moreLengths, setMoreLengths] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh values each time an item opens.
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setLength(task.durationMinutes);
    setStageId(task.stageId);
    setChosen(keysFor(detail, task.assigneeIds));
    setSearch("");
    setMoreLengths(task.durationMinutes !== null && !QUICK.includes(task.durationMinutes));
    setError(null);
    // Only when a different item opens, not when the program refreshes underneath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  // Everyone on the team, plus anyone already on this program who isn't on the list (yet).
  const options = useMemo(() => {
    const byKey = new Map(people.map((p) => [personKey(p), p]));
    for (const p of detail.participants) {
      const key = p.userId ? `u:${p.userId}` : p.contactId ? `c:${p.contactId}` : null;
      if (!key || byKey.has(key)) continue;
      byKey.set(key, p.userId ? { kind: "member", userId: p.userId, name: p.name, email: p.email ?? "" } : { kind: "contact", contactId: p.contactId!, name: p.name, email: p.email });
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [people, detail.participants]);
  const q = search.trim().toLowerCase();
  const shown = q ? options.filter((p) => p.name.toLowerCase().includes(q)) : options;
  const exact = options.some((p) => p.name.toLowerCase() === q);

  async function close() {
    if (!task) return props.onClose();
    if (!title.trim()) return setError("Give this item a title.");
    setBusy(true);
    try {
      await props.onSave({ title: title.trim(), durationMinutes: length, stageId, who: options.filter((p) => chosen.includes(personKey(p))) });
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save this item. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function addGuest() {
    const name = search.trim();
    if (name.length < 2) return;
    try {
      const person = await props.onAddGuest(name, null);
      setChosen((c) => [...new Set([...c, personKey(person)])]);
      setSearch("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add them. Please try again.");
    }
  }

  const toggle = (key: string) => setChosen((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));
  const lengths = moreLengths ? ALL : QUICK;

  return (
    <Modal visible={!!task} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Save and close" />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetWrap} pointerEvents="box-none">
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.handle} />
            <View style={styles.titleRow}>
              <TextInput
                value={title}
                onChangeText={setTitle}
                style={styles.title}
                placeholder="What's this item?"
                placeholderTextColor={colors.muted}
                selectionColor={colors.accent}
                accessibilityLabel="Title"
                maxLength={120}
                multiline
                blurOnSubmit
              />
              <Pressable onPress={close} disabled={busy} accessibilityRole="button" style={({ pressed }) => [styles.done, pressed && { opacity: 0.8 }]}>
                <Text style={styles.doneText}>{busy ? "Saving…" : "Done"}</Text>
              </Pressable>
            </View>
            {props.alsoEditing ? <Text style={styles.also}>{props.alsoEditing} has this item open too. The last change saved wins.</Text> : null}
            {error ? (
              <Text style={styles.error} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 18, paddingBottom: 8 }}>
              <View style={{ gap: 10 }}>
                <Text style={styles.label}>Length (minutes)</Text>
                <View style={styles.chips}>
                  <Chip label="None yet" on={length === null} onPress={() => setLength(null)} />
                  {lengths.map((m) => (
                    <Chip key={m} label={String(m)} on={length === m} onPress={() => setLength(m)} />
                  ))}
                  {!moreLengths ? <Chip label="Other…" on={false} onPress={() => setMoreLengths(true)} /> : null}
                </View>
              </View>

              {detail.stages.length > 0 ? (
                <View style={{ gap: 10 }}>
                  <Text style={styles.label}>Stage</Text>
                  <View style={styles.chips}>
                    <Chip label="All stages" on={stageId === null} onPress={() => setStageId(null)} />
                    {detail.stages.map((s) => (
                      <Chip key={s.id} label={s.name} on={stageId === s.id} onPress={() => setStageId(s.id)} />
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={{ gap: 6 }}>
                <Text style={styles.label}>Who runs it{chosen.length ? ` · ${chosen.length} chosen` : ""}</Text>
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search the team, or type a guest's name"
                  placeholderTextColor={colors.muted}
                  selectionColor={colors.accent}
                  style={styles.search}
                  accessibilityLabel="Search people"
                  returnKeyType="done"
                />
                {q && !exact ? (
                  <Pressable onPress={addGuest} accessibilityRole="button" style={({ pressed }) => [styles.person, pressed && { opacity: 0.7 }]}>
                    <View style={[styles.avatar, { backgroundColor: "#1d1430" }]}>
                      <Text style={styles.avatarText}>+</Text>
                    </View>
                    <Text style={[styles.personName, { color: "#c48cff" }]}>Add “{search.trim()}” as a guest</Text>
                  </Pressable>
                ) : null}
                {shown.map((p) => {
                  const key = personKey(p);
                  const on = chosen.includes(key);
                  return (
                    <Pressable
                      key={key}
                      onPress={() => toggle(key)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      style={({ pressed }) => [styles.person, pressed && { opacity: 0.7 }]}
                    >
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{initials(p.name)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.personName}>{p.name}</Text>
                        {p.kind === "contact" ? <Text style={styles.personSub}>{p.email ? "Guest" : "Guest · no email yet"}</Text> : null}
                      </View>
                      <View style={[styles.check, on && styles.checkOn]}>{on ? <Text style={styles.tick}>✓</Text> : null}</View>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                onPress={() =>
                  Alert.alert("Delete this item?", `“${task?.title ?? ""}” comes off the program.`, [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => void props.onDelete().then(props.onClose) },
                  ])
                }
                accessibilityRole="button"
                style={styles.deleteRow}
              >
                <Text style={styles.deleteText}>Delete item</Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress(): void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: 0.8 }]}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

/** Who runs it, as the API takes it: `who`, or no one yet. */
export const whoBody = (who: TeamPerson[]) => (who.length ? { who: who.map(whoRef) } : { assigneeIds: [] });

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheetWrap: { justifyContent: "flex-end", maxHeight: "92%" },
  sheet: { backgroundColor: "#101116", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: "#2f3240", paddingHorizontal: 20, paddingTop: 10, gap: 14 },
  handle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: "#3a3f4c" },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  title: { flex: 1, color: colors.text, fontSize: 22, paddingVertical: 4, ...font("800") },
  done: { height: 38, paddingHorizontal: 16, borderRadius: 19, backgroundColor: colors.accent, justifyContent: "center" },
  doneText: { color: "#fff", fontSize: 15, ...font("700") },
  also: { color: "#bfe9f5", fontSize: 13, ...font("500") },
  error: { color: colors.danger, fontSize: 14, ...font("500") },
  label: { color: colors.muted, fontSize: 12, letterSpacing: 0.9, textTransform: "uppercase", ...font("700") },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minWidth: 48, height: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: "#16171d", alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 14, ...font("600") },
  chipTextOn: { color: "#fff" },
  search: { height: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: "#0b0c10", paddingHorizontal: 12, color: colors.text, fontSize: 15, ...font("400") },
  person: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1c1d24" },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#1d1430", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#c48cff", fontSize: 12, ...font("700") },
  personName: { color: colors.text, fontSize: 15, ...font("500") },
  personSub: { color: colors.muted, fontSize: 12, ...font("400") },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: "#3a3f4c", alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tick: { color: "#fff", fontSize: 13, ...font("800") },
  deleteRow: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  deleteText: { color: colors.danger, fontSize: 15, ...font("600") },
});

import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TextField } from "../components/TextField";
import type { EventDetail } from "../events/types";
import { fromZoned, toZoned } from "../lib/time";
import { colors, font } from "../theme";
import { WhenPicker } from "./WhenPicker";

/** The draft's name, date and start time, and deleting the draft. */
export function DetailsSheet({
  visible,
  data,
  onClose,
  onSave,
  onDelete,
}: {
  visible: boolean;
  data: EventDetail;
  onClose(): void;
  onSave(body: { name: string; startAt: string }): Promise<void>;
  onDelete(): Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const tz = data.event.timezone;
  const [name, setName] = useState(data.event.name);
  const [when, setWhen] = useState(() => toZoned(data.event.startAt, tz));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(data.event.name);
    setWhen(toZoned(data.event.startAt, tz));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function save() {
    if (!name.trim()) return setError("Give the program a name.");
    setBusy(true);
    try {
      await onSave({ name: name.trim(), startAt: fromZoned(when.day, when.minutes, tz) });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} pointerEvents="box-none">
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.handle} />
            <View style={styles.top}>
              <Text style={styles.title} accessibilityRole="header">
                Program details
              </Text>
              <Pressable onPress={save} disabled={busy} accessibilityRole="button" style={styles.done}>
                <Text style={styles.doneText}>{busy ? "Saving…" : "Save"}</Text>
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 18 }}>
              <TextField label="Name" value={name} onChangeText={setName} maxLength={120} />
              <WhenPicker day={when.day} minutes={when.minutes} onChange={(day, minutes) => setWhen({ day, minutes })} />
              {error ? (
                <Text style={styles.error} accessibilityRole="alert">
                  {error}
                </Text>
              ) : null}
              <Pressable
                onPress={() =>
                  Alert.alert("Delete this draft?", "The program and its items are deleted. Nobody has been told about it yet.", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => void onDelete().catch(() => setError("Couldn't delete it. Please try again.")) },
                  ])
                }
                accessibilityRole="button"
                style={styles.deleteRow}
              >
                <Text style={styles.deleteText}>Delete draft</Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#101116", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: "#2f3240", paddingHorizontal: 20, paddingTop: 10, gap: 14, maxHeight: "92%" },
  handle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: "#3a3f4c" },
  top: { flexDirection: "row", alignItems: "center" },
  title: { flex: 1, color: colors.text, fontSize: 20, ...font("800") },
  done: { height: 38, paddingHorizontal: 16, borderRadius: 19, backgroundColor: colors.accent, justifyContent: "center" },
  doneText: { color: "#fff", fontSize: 15, ...font("700") },
  error: { color: colors.danger, fontSize: 14, ...font("500") },
  deleteRow: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  deleteText: { color: colors.danger, fontSize: 15, ...font("600") },
});

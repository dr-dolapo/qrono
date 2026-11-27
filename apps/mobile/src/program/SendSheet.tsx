import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { EventDetail } from "../events/types";
import { api } from "../lib/api";
import { colors, font } from "../theme";

interface Member {
  role: string;
  status: string;
  user: { id: string; firstName: string; lastName: string };
}

/** Send for approval: choose which Admins review it (all of them, to start with). */
export function SendSheet({ visible, data, onClose, onSend }: { visible: boolean; data: EventDetail; onClose(): void; onSend(approverIds: string[]): Promise<void> }) {
  const insets = useSafeAreaInsets();
  const [approvers, setApprovers] = useState<{ id: string; name: string }[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const self = data.team?.allowSelfApproval ?? false;

  useEffect(() => {
    if (!visible) return;
    setError(null);
    api<{ members: Member[] }>(`/teams/${encodeURIComponent(data.event.teamId)}/members`)
      .then(({ members }) => {
        const list = members
          .filter((m) => m.status === "active" && m.role === "approver" && (self || m.user.id !== data.me.userId))
          .map((m) => ({ id: m.user.id, name: `${m.user.firstName} ${m.user.lastName}`.trim() }));
        setApprovers(list);
        setChosen(list.map((a) => a.id));
      })
      .catch(() => setError("Couldn't load the Admins. Check your connection."));
  }, [visible, data.event.teamId, data.me.userId, self]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await onSend(chosen);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send it. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />
          <Text style={styles.title} accessibilityRole="header">
            Send for approval
          </Text>
          <Text style={styles.sub}>The program is locked while it’s reviewed. Who should approve it?</Text>
          {approvers === null && !error ? <Text style={styles.sub}>Loading…</Text> : null}
          {approvers?.length === 0 ? <Text style={styles.sub}>There’s no Admin who can approve this yet. Ask an Admin to make someone an approver.</Text> : null}
          {approvers?.map((a) => {
            const on = chosen.includes(a.id);
            return (
              <Pressable
                key={a.id}
                onPress={() => setChosen((c) => (on ? c.filter((x) => x !== a.id) : [...c, a.id]))}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                style={styles.row}
              >
                <Text style={styles.name}>{a.name}</Text>
                <View style={[styles.check, on && styles.checkOn]}>{on ? <Text style={styles.tick}>✓</Text> : null}</View>
              </Pressable>
            );
          })}
          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Pressable
            onPress={send}
            disabled={busy || chosen.length === 0}
            accessibilityRole="button"
            style={({ pressed }) => [styles.send, (busy || chosen.length === 0) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.sendText}>{busy ? "Sending…" : "Send"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#101116", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: "#2f3240", paddingHorizontal: 20, paddingTop: 10, gap: 12 },
  handle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: "#3a3f4c" },
  title: { color: colors.text, fontSize: 20, ...font("800") },
  sub: { color: colors.muted, fontSize: 14, lineHeight: 20, ...font("400") },
  row: { flexDirection: "row", alignItems: "center", minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1c1d24" },
  name: { flex: 1, color: colors.text, fontSize: 16, ...font("500") },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: "#3a3f4c", alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tick: { color: "#fff", fontSize: 13, ...font("800") },
  error: { color: colors.danger, fontSize: 14, ...font("500") },
  send: { height: 50, borderRadius: 25, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginTop: 4 },
  sendText: { color: "#fff", fontSize: 16, ...font("700") },
});

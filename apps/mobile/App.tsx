import { StatusBar } from "expo-status-bar";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

/**
 * Qrono participant app.
 *
 * Scope for v1 (PRD §1.1): the event program, my tasks, the countdown,
 * task comments, broadcasts (push, with Acknowledge / Snooze / Done),
 * accepting or declining a role, and approving events for Approvers.
 * Sign-up happens on the web; the app offers log in and password reset.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <Text style={styles.brand} accessibilityRole="header">
            Qrono
          </Text>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.sectionTitle}>My events</Text>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No events yet</Text>
            <Text style={styles.cardBody}>
              Events you're assigned to will appear here, with your tasks and a countdown to the start.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const colors = {
  background: "#0b0d12",
  surface: "#161a22",
  border: "#232835",
  text: "#f4f5f7",
  muted: "#a3a9b6",
  accent: "#f5b301",
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 20, paddingVertical: 14 },
  brand: { color: colors.text, fontSize: 22, fontWeight: "800" },
  content: { padding: 20, gap: 12 },
  sectionTitle: { color: colors.text, fontSize: 24, fontWeight: "600" },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 6,
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  cardBody: { color: colors.muted, fontSize: 14, lineHeight: 20 },
});

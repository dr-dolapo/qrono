import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { colors } from "../theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <RootStack />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function RootStack() {
  const { status } = useAuth();
  // The saved session is read from secure storage before the first screen shows.
  if (status === "loading") return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  const signedIn = status === "signedIn";
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
        <Stack.Screen name="forgot-password" options={{ headerShown: true, title: "Reset password", headerBackTitle: "Log in" }} />
      </Stack.Protected>
    </Stack>
  );
}

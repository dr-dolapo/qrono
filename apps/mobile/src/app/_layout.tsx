import { useFonts } from "expo-font";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { Inter_800ExtraBold } from "@expo-google-fonts/inter/800ExtraBold";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { UpdateBanner } from "../components/UpdateBanner";
import { NotificationRouter } from "../notifications/NotificationRouter";
import { backdrop, colors, font } from "../theme";

export default function RootLayout() {
  // Inter ships inside the app bundle, so this resolves almost instantly and works offline.
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });
  if (!fontsLoaded && !fontError) return <View style={backdrop} />;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <View style={backdrop}>
          <RootStack />
        </View>
        <UpdateBanner />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function RootStack() {
  const { status } = useAuth();
  // The saved session is read from secure storage before the first screen shows.
  if (status === "loading") return null;

  const signedIn = status === "signedIn";
  return (
    <>
      <NotificationRouter />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "transparent" },
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { ...font("600"), fontSize: 17 },
          headerBackTitleStyle: { ...font("400") },
          headerShadowVisible: false,
        }}
      >
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="index" />
          <Stack.Screen name="events/[id]/index" options={{ headerShown: true, title: "", headerBackTitle: "Events" }} />
          <Stack.Screen name="events/[id]/live" options={{ headerShown: true, title: "Live", headerBackTitle: "Program" }} />
          <Stack.Screen name="events/[id]/tasks/[taskId]" options={{ headerShown: true, title: "Task", headerBackTitle: "Program" }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
          <Stack.Screen name="forgot-password" options={{ headerShown: true, title: "Reset password", headerBackTitle: "Log in" }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

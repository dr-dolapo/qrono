import Constants from "expo-constants";
import * as Device from "expo-device";
import { isRunningInExpoGo } from "expo";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "../lib/api";

/** The Android channel and the action buttons the API's push messages refer to (apps/api/src/push.ts). */
export const BROADCAST_CHANNEL = "broadcasts";
export const BROADCAST_CATEGORY = "broadcast";
export const INBOX_CHANNEL = "inbox";

let registeredToken: string | null = null;

// Show broadcasts even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export type PushSetup = "registered" | "expo-go" | "simulator" | "denied" | "failed";

/**
 * Asks for permission, sets up the broadcast channel and buttons, and registers this
 * phone's push token with the API so broadcasts reach it with the app closed (QR040).
 * Push needs a real build of the app: in Expo Go broadcasts only show inside the app.
 */
export async function registerForPush(): Promise<PushSetup> {
  if (isRunningInExpoGo()) return "expo-go";
  if (!Device.isDevice) return "simulator";
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(BROADCAST_CHANNEL, {
        name: "Broadcasts",
        description: "Messages from the organisers during a live event",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 400, 200, 400],
        lightColor: "#A97BFF",
        sound: "default",
      });
      await Notifications.setNotificationChannelAsync(INBOX_CHANNEL, {
        name: "Inbox",
        description: "Approvals, new parts and invitations",
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: "#A97BFF",
        sound: "default",
      });
    }
    await Notifications.setNotificationCategoryAsync(BROADCAST_CATEGORY, [
      { identifier: "acknowledged", buttonTitle: "Acknowledge", options: { opensAppToForeground: true } },
      { identifier: "snoozed", buttonTitle: "Snooze 3 min", options: { opensAppToForeground: true } },
      { identifier: "done", buttonTitle: "Done", options: { opensAppToForeground: true } },
    ]);

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== "granted") return "denied";

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await api("/me/devices", { body: { token, platform: Platform.OS === "ios" ? "ios" : "android" } });
    registeredToken = token;
    return "registered";
  } catch (err) {
    console.warn("Push registration failed", err);
    return "failed";
  }
}

/** On log out: stop this phone getting the user's broadcasts. Never blocks logging out. */
export async function unregisterPush(): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return;
  await api("/me/devices/unregister", { body: { token } }).catch(() => undefined);
}

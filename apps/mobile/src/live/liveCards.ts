/**
 * The lock-screen card during a live event you're on.
 *
 *  - iOS: a Live Activity. The server opens it by push (iOS 17.2+) and updates it through
 *    Apple. This file sends Apple's tokens to the server, and opens or refreshes the card
 *    itself whenever the app is open (older iOS, or if a push was missed).
 *  - Android: a Live Update. The server sends silent data pushes; this file draws the card,
 *    including from the background task when the app is closed.
 */
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { addPushToStartTokenListener, type LiveActivity } from "expo-widgets";
import { AppState, Platform } from "react-native";
import { LiveUpdates, type LiveCard } from "../../modules/qrono-live-updates/src";
import { api } from "../lib/api";
import { QronoLiveActivity } from "./QronoLiveActivity";

export const LIVE_TASK = "qrono-live-card";

type LiveData = { type?: string; eventId?: string; card?: string; alert?: string };

/** Silent pushes arrive as plain data, or (from the background task) wrapped in dataString. */
function liveData(payload: unknown): LiveData | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { data?: { dataString?: string } & LiveData } & LiveData;
  if (p.type) return p;
  if (p.data?.dataString) {
    try {
      return JSON.parse(p.data.dataString) as LiveData;
    } catch {
      return null;
    }
  }
  return p.data?.type ? p.data : null;
}

function applyAndroid(data: LiveData | null) {
  if (!data) return;
  if (data.type === "live" && data.card) LiveUpdates.show(JSON.parse(data.card) as LiveCard, data.alert === "1");
  if (data.type === "live-end" && data.eventId) LiveUpdates.end(data.eventId);
}

// Must be defined when the JS loads (also in the background), before anything is registered.
if (Platform.OS === "android" && LiveUpdates.available) {
  TaskManager.defineTask(LIVE_TASK, async ({ data }) => applyAndroid(liveData(data)));
}

/** iOS: cards this app opened, by ActivityKit id → event. Cards the server opened aren't listed; it knows their event. */
const opened = new Map<string, string>();
const watched = new Set<string>();

function sendActivityToken(activity: LiveActivity<LiveCard>) {
  const id = activity.getId();
  if (watched.has(id)) return;
  watched.add(id);
  const post = (token: string | null) =>
    token && void api("/me/live-activity-tokens", { body: { token, kind: "activity", eventId: opened.get(id) } }).catch(() => undefined);
  activity.addPushTokenListener((e) => post(e.pushToken));
  void activity.getPushToken().then(post).catch(() => undefined);
}

/** Brings this phone's cards in line with the server's view (when the app opens or comes back). */
export async function reconcileLiveCards(): Promise<void> {
  let cards: LiveCard[];
  try {
    ({ cards } = await api<{ cards: LiveCard[] }>("/me/live-cards"));
  } catch {
    return; // Offline: leave things as they are.
  }
  // Your part first, if two events are live at once.
  cards.sort((a, b) => Number(b.urgent) - Number(a.urgent));

  if (Platform.OS === "android") {
    for (const id of LiveUpdates.activeEventIds()) if (!cards.some((c) => c.eventId === id)) LiveUpdates.end(id);
    for (const card of cards) LiveUpdates.show(card, false);
    return;
  }

  if (!QronoLiveActivity) return;
  const running = QronoLiveActivity.getInstances();
  if (cards.length === 0) {
    await Promise.all(running.map((a) => a.end("immediate").catch(() => undefined)));
    return;
  }
  if (running.length === 0) {
    try {
      const card = cards[0]!;
      const activity = QronoLiveActivity.start(card, `qrono://events/${card.eventId}/live`);
      opened.set(activity.getId(), card.eventId);
      sendActivityToken(activity);
    } catch (err) {
      // Live Activities turned off for Qrono in Settings, or an older iOS.
      console.warn("Couldn't start the Live Activity", err);
    }
    return;
  }
  for (const activity of running) {
    sendActivityToken(activity);
    const card = cards.find((c) => c.eventId === opened.get(activity.getId())) ?? cards[0]!;
    // Updating from the app is free: it doesn't use iOS's push budget.
    void activity.update(card).catch(() => undefined);
  }
}

let started = false;

/** Once signed in (and the email confirmed): hook everything up. */
export function startLiveCards(): () => void {
  if (started) return () => undefined;
  started = true;
  const subs: { remove(): void }[] = [];

  if (Platform.OS === "ios" && QronoLiveActivity) {
    // Lets the server open a card on this phone when an event goes live (iOS 17.2+).
    subs.push(
      addPushToStartTokenListener(({ activityPushToStartToken }) => {
        void api("/me/live-activity-tokens", { body: { token: activityPushToStartToken, kind: "start" } }).catch(() => undefined);
      }),
    );
  }
  if (Platform.OS === "android" && LiveUpdates.available) {
    void Notifications.registerTaskAsync(LIVE_TASK).catch(() => undefined);
    // With the app open, the silent push comes through here instead.
    subs.push(Notifications.addNotificationReceivedListener((n) => applyAndroid(liveData(n.request.content.data))));
  }

  void reconcileLiveCards();
  const app = AppState.addEventListener("change", (s) => s === "active" && void reconcileLiveCards());
  subs.push(app);

  return () => {
    subs.forEach((s) => s.remove());
    started = false;
  };
}

/** On log out: take this phone's cards down. */
export async function clearLiveCards(): Promise<void> {
  if (Platform.OS === "android") LiveUpdates.activeEventIds().forEach((id) => LiveUpdates.end(id));
  if (QronoLiveActivity) await Promise.all(QronoLiveActivity.getInstances().map((a) => a.end("immediate").catch(() => undefined)));
}

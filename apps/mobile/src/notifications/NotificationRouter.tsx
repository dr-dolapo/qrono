import { router, useRootNavigationState } from "expo-router";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthProvider";
import { replyToBroadcast, type BroadcastReply } from "../broadcasts/api";
import { registerForPush } from "./push";

const REPLIES = new Set<string>(["acknowledged", "snoozed", "done"]);

/**
 * While signed in: registers this phone for push, and handles taps on broadcast
 * notifications. A reply button (Acknowledge / Snooze / Done) sends the reply;
 * either way the app opens the event's live view. Inbox pushes open the Inbox at that item.
 */
export function NotificationRouter() {
  const { status, user } = useAuth();
  const navReady = !!useRootNavigationState()?.key;
  const handled = useRef(new Set<string>());

  const verified = status === "signedIn" && !!user?.emailVerified;
  useEffect(() => {
    if (verified) void registerForPush();
  }, [verified]);

  useEffect(() => {
    if (!navReady || status !== "signedIn") return;

    const handle = async (response: Notifications.NotificationResponse) => {
      const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
      if (handled.current.has(key)) return;
      handled.current.add(key);

      const data = response.notification.request.content.data as
        | { type?: string; eventId?: string; broadcastId?: string; inboxKey?: string }
        | undefined;
      // Something waiting in the Inbox: open it there.
      if (data?.type === "inbox") {
        router.navigate({ pathname: "/inbox", params: data.inboxKey ? { focus: data.inboxKey } : {} });
        return;
      }
      if (data?.type !== "broadcast" || !data.eventId || !data.broadcastId) return;
      if (REPLIES.has(response.actionIdentifier)) {
        await replyToBroadcast(data.eventId, data.broadcastId, response.actionIdentifier as BroadcastReply).catch(() => undefined);
      }
      router.push({ pathname: "/events/[id]/live", params: { id: data.eventId } });
    };

    // A notification that opened the app from closed, then any tapped while it runs.
    void Notifications.getLastNotificationResponseAsync().then((r) => r && handle(r));
    const sub = Notifications.addNotificationResponseReceivedListener((r) => void handle(r));
    return () => sub.remove();
  }, [navReady, status]);

  return null;
}

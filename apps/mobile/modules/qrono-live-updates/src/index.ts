import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

export interface LiveCard {
  eventId: string;
  eventName: string;
  headline: string;
  detail: string | null;
  urgent: boolean;
  broadcast: string | null;
  broadcastAt: string | null;
}

interface Native {
  show(card: LiveCard, alert: boolean): void;
  end(eventId: string): void;
  activeEventIds(): string[];
  canPromote(): boolean;
  openSettings(): void;
}

/** Android only; null elsewhere, or in a build made before this module existed. */
const native = Platform.OS === "android" ? requireOptionalNativeModule<Native>("QronoLiveUpdates") : null;

export const LiveUpdates = {
  available: !!native,
  show: (card: LiveCard, alert = false) => native?.show(card, alert),
  end: (eventId: string) => native?.end(eventId),
  activeEventIds: (): string[] => native?.activeEventIds() ?? [],
  canPromote: () => native?.canPromote() ?? false,
  openSettings: () => native?.openSettings(),
};

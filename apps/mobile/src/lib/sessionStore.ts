import * as SecureStore from "expo-secure-store";
import type { User } from "../auth/types";

/** What we keep on the phone between launches. The token sits in the iOS Keychain / Android Keystore. */
export interface StoredSession {
  token: string;
  user: User;
}

const KEY = "qrono.session";

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export async function saveSession(session: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
}

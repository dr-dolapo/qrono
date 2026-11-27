import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { ApiError, api } from "./api";
import { readCache, writeCache } from "./cache";
import { onConnectivityChange } from "./connectivity";

/**
 * Things done with no connection ("I can't make it", a reply to a broadcast), saved and sent
 * in order once the server can be reached again. The change shows on the phone straight away.
 */
export interface Pending {
  id: string;
  path: string;
  body: unknown;
  /** What it was, for the offline banner. */
  label: string;
  createdAt: string;
}

const KEY = "outbox";
let items: Pending[] = readCache<Pending[]>(KEY)?.value ?? [];
const listeners = new Set<() => void>();

function save(next: Pending[]) {
  items = next;
  writeCache(KEY, items);
  for (const l of listeners) l();
}

/**
 * Sends now if possible; if the server can't be reached, saves it for later and resolves
 * with null. Any other failure (the server said no) is thrown as usual.
 */
export async function sendOrQueue<T>(path: string, body: unknown, label: string): Promise<T | null> {
  try {
    return await api<T>(path, { body });
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "network") throw err;
    // A newer copy of the same change replaces the older one (e.g. declined, then attending after all).
    save([...items.filter((p) => p.path !== path), { id: `${Date.now()}-${Math.random()}`, path, body, label, createdAt: new Date().toISOString() }]);
    return null;
  }
}

let flushing = false;

/** Sends what's waiting, oldest first. Stops at the first one that can't get through. */
export async function flushOutbox(): Promise<void> {
  if (flushing || items.length === 0) return;
  flushing = true;
  try {
    while (items.length > 0) {
      const next = items[0]!;
      try {
        await api(next.path, { body: next.body });
      } catch (err) {
        if (err instanceof ApiError && err.code === "network") return;
        // The server turned it down (the event has ended, say): there's no point retrying.
      }
      save(items.filter((p) => p.id !== next.id));
    }
  } finally {
    flushing = false;
  }
}

export function pendingCount(): number {
  return items.length;
}

export function usePendingCount(): number {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    pendingCount,
    pendingCount,
  );
}

export function clearOutbox(): void {
  items = [];
  for (const l of listeners) l();
}

// Try again when the connection comes back, when the app comes to the front, and every 30 seconds.
onConnectivityChange((online) => {
  if (online) void flushOutbox();
});
AppState.addEventListener("change", (s) => {
  if (s === "active") void flushOutbox();
});
setInterval(() => {
  // Offline too: a send that gets through is how we find out the connection is back.
  if (items.length > 0) void flushOutbox();
}, 30_000);

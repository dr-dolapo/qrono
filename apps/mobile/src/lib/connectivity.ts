import { useSyncExternalStore } from "react";

/**
 * Whether Qrono's server is reachable right now, learned from the app's own requests (and the
 * live connection): a request that can't get through means offline; any answer means online.
 * No extra pings, which matters on metered data.
 */
let online = true;
const listeners = new Set<(online: boolean) => void>();

export function reportOnline(value: boolean): void {
  if (online === value) return;
  online = value;
  for (const l of listeners) l(value);
}

export function isOnline(): boolean {
  return online;
}

export function onConnectivityChange(listener: (online: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOnline(): boolean {
  return useSyncExternalStore(onConnectivityChange, isOnline, isOnline);
}

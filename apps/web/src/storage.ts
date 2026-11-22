/**
 * localStorage that never throws (private browsing, storage disabled).
 * Only used for small per-browser conveniences.
 */
export const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/**
 * An invitation the person opened before they had an account. Kept so that
 * after signing up and confirming their email they land back on it.
 */
export const pendingInvite = {
  get: () => storage.get("qrono.pendingInvite"),
  set: (token: string) => storage.set("qrono.pendingInvite", token),
  clear: () => storage.remove("qrono.pendingInvite"),
};

import { Directory, File, Paths } from "expo-file-system";

/**
 * What the app has saved on the phone, so events open instantly and keep working with a weak
 * or no connection. One JSON file per key under the app's documents folder:
 *
 *  - "events"           the Events list
 *  - "event:<id>"       an event and its program
 *  - "broadcasts:<id>"  the messages you received for it
 *  - "live:<id>"        the live room's last state
 *  - "outbox"           things you did offline, waiting to send
 *
 * Reads are synchronous, so a screen can draw from what's saved on its very first frame.
 * Cleared on sign-out.
 */
export interface Saved<T> {
  value: T;
  /** When it was last confirmed fresh by the server (epoch ms). */
  savedAt: number;
  /** The server's version tag, so a check can come back "unchanged" without a download. */
  etag: string | null;
}

const dir = new Directory(Paths.document, "qrono-cache");

function fileFor(key: string): File {
  return new File(dir, `${encodeURIComponent(key)}.json`);
}

export function readCache<T>(key: string): Saved<T> | null {
  try {
    const file = fileFor(key);
    if (!file.exists) return null;
    return JSON.parse(file.textSync()) as Saved<T>;
  } catch {
    return null;
  }
}

/** Saves `value` (written in the background; a failed write only costs the offline copy). */
export function writeCache<T>(key: string, value: T, etag: string | null = null, savedAt = Date.now()): Saved<T> {
  const saved: Saved<T> = { value, savedAt, etag };
  try {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const file = fileFor(key);
    if (!file.exists) file.create({ intermediates: true, overwrite: true });
    file.write(JSON.stringify(saved)).catch(() => undefined);
  } catch {
    /* storage full or unavailable: carry on online */
  }
  return saved;
}

/** Marks what's saved as confirmed fresh, without rewriting it. */
export function touchCache(key: string): void {
  const saved = readCache(key);
  if (saved) writeCache(key, saved.value, saved.etag);
}

export function removeCache(key: string): void {
  try {
    const file = fileFor(key);
    if (file.exists) file.delete();
  } catch {
    /* already gone */
  }
}

export function cacheKeys(): string[] {
  try {
    if (!dir.exists) return [];
    return dir
      .list()
      .filter((e): e is File => e instanceof File && e.name.endsWith(".json"))
      .map((f) => decodeURIComponent(f.name.slice(0, -".json".length)));
  } catch {
    return [];
  }
}

/** Sign-out: nothing of this account stays on the phone. */
export function clearCache(): void {
  try {
    if (dir.exists) dir.delete();
  } catch {
    /* nothing saved */
  }
}

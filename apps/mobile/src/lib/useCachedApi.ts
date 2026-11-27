import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ApiError, apiIfChanged } from "./api";
import { readCache, removeCache, writeCache } from "./cache";

export interface CachedResource<T> {
  data: T | null;
  /** Only when there's nothing saved to show (a weak connection with saved data isn't an error). */
  error: ApiError | null;
  /** True only when there's nothing saved and the first load is still running. */
  loading: boolean;
  /** True while a pull-to-refresh is running. */
  refreshing: boolean;
  /** When what's shown was last confirmed fresh by the server (epoch ms), or null. */
  savedAt: number | null;
  refresh(): Promise<void>;
  /** Replace the data with a fresher copy (e.g. what the API returned after a change), and save it. */
  setData(data: T): void;
}

/**
 * Shows what's saved on the phone straight away, then checks the server for changes: when the
 * screen comes into view, every `everyMs` while it stays open, and on pull-to-refresh. A check
 * sends the saved version, so "unchanged" costs a few bytes.
 */
export function useCachedApi<T>(path: string, key: string, everyMs: (data: T | null) => number): CachedResource<T> {
  const [saved, setSaved] = useState(() => readCache<T>(key));
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(saved === null);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(0);
  const current = useRef(saved);
  current.current = saved;

  const load = useCallback(async () => {
    const call = ++latest.current;
    try {
      const result = await apiIfChanged<T>(path, current.current?.etag ?? null);
      if (call !== latest.current) return;
      const next = result.changed ? writeCache(key, result.data, result.etag) : current.current && writeCache(key, current.current.value, current.current.etag);
      setSaved(next);
      setError(null);
    } catch (err) {
      if (call !== latest.current) return;
      const e = err instanceof ApiError ? err : new ApiError(0, "Something went wrong. Please try again.");
      // Gone, or no longer yours: don't keep showing a saved copy.
      if (e.status === 403 || e.status === 404) {
        removeCache(key);
        setSaved(null);
      }
      setError(e);
    } finally {
      if (call === latest.current) setLoading(false);
    }
  }, [path, key]);

  useFocusEffect(
    useCallback(() => {
      void load();
      let timer: ReturnType<typeof setTimeout>;
      const tick = () => {
        timer = setTimeout(() => {
          void load().finally(tick);
        }, everyMs(current.current?.value ?? null));
      };
      tick();
      return () => clearTimeout(timer);
      // everyMs is read when each wait starts, so it can follow the data (faster on event day).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const setData = useCallback(
    (data: T) => {
      setSaved(writeCache(key, data, null));
    },
    [key],
  );

  return {
    data: saved?.value ?? null,
    // With something saved, a failed check is shown as "offline", not as an error.
    error: saved ? null : error,
    loading: loading && saved === null,
    refreshing,
    savedAt: saved?.savedAt ?? null,
    refresh,
    setData,
  };
}

const MINUTE = 60_000;

/** How often to check an event: every minute on the day (and while live), every 5 minutes otherwise. */
export function eventCheckEvery(event: { startAt: string; endAt: string; status: string } | null | undefined): number {
  if (!event) return 5 * MINUTE;
  const now = Date.now();
  const start = Date.parse(event.startAt);
  const end = Date.parse(event.endAt);
  const eventDay = event.status === "live" || (start - now < 24 * 60 * MINUTE && end > now - 60 * MINUTE);
  return eventDay ? MINUTE : 5 * MINUTE;
}

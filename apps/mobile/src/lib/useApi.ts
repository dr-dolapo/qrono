import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ApiError, api } from "./api";

interface Resource<T> {
  data: T | null;
  error: ApiError | null;
  /** True only for the first load, when there's nothing to show yet. */
  loading: boolean;
  /** True while a pull-to-refresh is running. */
  refreshing: boolean;
  refresh(): Promise<void>;
}

/** Loads `path` from the API, and again whenever the screen comes back into view. */
export function useApi<T>(path: string): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const call = ++latest.current;
    try {
      const result = await api<T>(path);
      if (call !== latest.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (call !== latest.current) return;
      setError(err instanceof ApiError ? err : new ApiError(0, "Something went wrong. Please try again."));
    } finally {
      if (call === latest.current) setLoading(false);
    }
  }, [path]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { data, error, loading, refreshing, refresh };
}

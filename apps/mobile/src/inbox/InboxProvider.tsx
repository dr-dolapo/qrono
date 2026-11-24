import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { ApiError, api } from "../lib/api";
import type { InboxData } from "./types";

interface InboxContextValue {
  data: InboxData | null;
  error: ApiError | null;
  refreshing: boolean;
  refresh(): Promise<void>;
  /** Use what an action returned (the API answers with the fresh Inbox). */
  setData(data: InboxData): void;
}

const InboxContext = createContext<InboxContextValue | null>(null);
const POLL_MS = 60_000;

/**
 * The Inbox, shared by the tab badge and the Inbox screen. Loaded on start, when the
 * app comes back to the front, every minute while it's open, and after each action.
 */
export function InboxProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<InboxData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const call = ++latest.current;
    try {
      const fresh = await api<InboxData>("/me/inbox");
      if (call === latest.current) {
        setData(fresh);
        setError(null);
      }
    } catch (err) {
      if (call === latest.current) setError(err instanceof ApiError ? err : new ApiError(0, "Couldn't load your Inbox."));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void load();
    }, POLL_MS);
    const sub = AppState.addEventListener("change", (s) => s === "active" && void load());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const replace = useCallback((d: InboxData) => {
    latest.current++;
    setData(d);
  }, []);

  const value = useMemo(() => ({ data, error, refreshing, refresh, setData: replace }), [data, error, refreshing, refresh, replace]);
  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export function useInbox(): InboxContextValue {
  const ctx = useContext(InboxContext);
  if (!ctx) throw new Error("useInbox must be used inside InboxProvider");
  return ctx;
}

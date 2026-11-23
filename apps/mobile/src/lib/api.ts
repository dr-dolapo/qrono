import { QRONO_URL } from "../config";

/** An error from the Qrono API, with a message that's safe to show the user. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    /** Per-field messages, keyed by field name, when the API rejects a form. */
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

/** The session token sent with every request (null when logged out). */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

/** The current session token, for connections fetch() doesn't make (the live WebSocket). */
export function getAuthToken(): string | null {
  return authToken;
}

/** Called when the API says the stored session is no longer valid. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** Call the Qrono API. Throws ApiError with a user-friendly message on failure. */
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!QRONO_URL) {
    throw new ApiError(0, "This copy of the app isn't connected to a Qrono server yet.", "not_configured");
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    // Tells the API to hand back a session token instead of a browser cookie.
    "X-Qrono-Client": "mobile",
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const sentToken = authToken;
  if (sentToken) headers.Authorization = `Bearer ${sentToken}`;

  let res: Response;
  try {
    res = await fetch(`${QRONO_URL}/api${path}`, {
      method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach Qrono. Check your internet connection and try again.", "network");
  }

  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string; code?: string; fields?: Record<string, string> })
    | null;

  if (!res.ok) {
    if (res.status === 401 && sentToken && sentToken === authToken) onUnauthorized?.();
    throw new ApiError(res.status, data?.error ?? "Something went wrong. Please try again.", data?.code, data?.fields ?? {});
  }
  return data as T;
}

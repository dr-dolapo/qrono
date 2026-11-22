/** Error returned by the Qrono API: a message plus optional per-field messages. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Calls the API on the same origin with the session cookie. Throws ApiError on failure. */
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
      credentials: "same-origin",
      headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach Qrono. Check your connection and try again.");
  }

  const data = res.headers.get("Content-Type")?.includes("application/json") ? await res.json() : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? "Something went wrong. Please try again.", data?.fields, data?.code);
  }
  return data as T;
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  emailVerified: boolean;
}

export type Role = "approver" | "admin" | "member";

export interface TeamSummary {
  id: string;
  name: string;
  role: Role;
  status: "pending_vetting" | "active" | "removed";
}

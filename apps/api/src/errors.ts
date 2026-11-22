import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Stop handling a request and answer with { error, code?, fields? }. */
export function fail(
  status: ContentfulStatusCode,
  error: string,
  extra: { code?: string; fields?: Record<string, string> } = {},
): never {
  throw new HTTPException(status, {
    res: new Response(JSON.stringify({ error, ...extra }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  });
}

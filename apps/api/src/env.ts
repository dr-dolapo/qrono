import type { LiveEvent } from "./live-event";

/** Bindings configured in wrangler.jsonc. */
export interface Env {
  DB: D1Database;
  LIVE_EVENT: DurableObjectNamespace<LiveEvent>;
  APP_ENV: string;
}

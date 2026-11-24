import { app } from "./app";
import type { Env } from "./env";
import { sendDueReminders } from "./reminders";

export { LiveEvent } from "./live-event";

export default {
  fetch: app.fetch,
  /** Cron trigger (every 5 minutes): reminder emails before events. */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(sendDueReminders(env).then((n) => n && console.log(`Sent ${n} reminder emails`)));
  },
} satisfies ExportedHandler<Env>;

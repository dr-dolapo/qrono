import { app } from "./app";
import type { Env } from "./env";
import { sendDueReminders } from "./reminders";
import { pruneArchive } from "./inboxArchive";

export { LiveEvent } from "./live-event";

export default {
  fetch: app.fetch,
  /** Cron trigger (every 5 minutes): reminder emails before events. */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(sendDueReminders(env).then((n) => n && console.log(`Sent ${n} reminder emails`)));
    // The Inbox's Archived list keeps 60 days.
    ctx.waitUntil(pruneArchive(env.DB).catch((err) => console.error("Archive cleanup failed", err)));
  },
} satisfies ExportedHandler<Env>;

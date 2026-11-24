import type { LiveEvent } from "./live-event";

/** Cloudflare Email Service "send_email" binding (structured send). */
export interface EmailBinding {
  send(message: {
    from: string | { email: string; name?: string };
    to: string | { email: string; name?: string };
    subject: string;
    html?: string;
    text?: string;
  }): Promise<{ messageId: string }>;
}

/** Bindings and variables configured in wrangler.jsonc. */
export interface Env {
  DB: D1Database;
  LIVE_EVENT: DurableObjectNamespace<LiveEvent>;
  APP_ENV: string;
  /** Public URL of the web app, e.g. https://app.qrono.com. Used for email links and the origin check. */
  APP_ORIGIN: string;
  /** "log" prints emails to the console (local dev); "send" uses the EMAIL binding. */
  EMAIL_MODE: "log" | "send";
  /** Sender address, e.g. "Qrono <no-reply@qrono.com>". Must be on a domain onboarded to Email Service. */
  MAIL_FROM: string;
  EMAIL?: EmailBinding;
  /** Optional Expo access token, needed only if push "enhanced security" is on. Set as a Worker secret. */
  EXPO_ACCESS_TOKEN?: string;
  /** Apple push key (.p8 file contents), its Key ID and the Apple Team ID: for iOS Live Activities. Worker secrets. */
  APNS_KEY?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  /** Defaults to production (api.push.apple.com); "api.sandbox.push.apple.com" for development builds. */
  APNS_HOST?: string;
}

/** Variables set on the request context by middleware. */
export interface Vars {
  user: AuthedUser | null;
  sessionId: string | null;
}

export interface AuthedUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  emailVerified: boolean;
}

export type AppEnv = { Bindings: Env; Variables: Vars };

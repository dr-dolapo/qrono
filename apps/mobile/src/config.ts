/**
 * The Qrono web address the app talks to, e.g. https://qrono-web.example.workers.dev.
 * The API lives under /api on the same address. Set EXPO_PUBLIC_QRONO_URL in apps/mobile/.env
 * for local work, and in eas.json for store builds.
 */
export const QRONO_URL = (process.env.EXPO_PUBLIC_QRONO_URL ?? "").replace(/\/+$/, "");

/** A page on the Qrono website, such as /signup. */
export function webUrl(path: string): string {
  return `${QRONO_URL}${path}`;
}

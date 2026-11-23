/** The live Qrono. The API lives under /api on the same address. */
const DEFAULT_QRONO_URL = "https://app.qrono.co.uk";

/**
 * The Qrono web address the app talks to. Uses the live Qrono unless
 * EXPO_PUBLIC_QRONO_URL is set (e.g. in apps/mobile/.env to point at a local API).
 */
export const QRONO_URL = (process.env.EXPO_PUBLIC_QRONO_URL || DEFAULT_QRONO_URL).replace(/\/+$/, "");

/** A page on the Qrono website, such as /signup. */
export function webUrl(path: string): string {
  return `${QRONO_URL}${path}`;
}

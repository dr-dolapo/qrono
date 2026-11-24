/**
 * Apple Push Notification service, used directly for iOS Live Activities: Expo's
 * push service handles ordinary notifications but not ActivityKit pushes.
 * Token-based auth: an ES256 JWT signed with the team's .p8 key, reused for 50 minutes.
 */
import type { Env } from "./env";

export const BUNDLE_ID = "uk.co.qrono.app";
type ApnsEnv = Pick<Env, "APNS_KEY" | "APNS_KEY_ID" | "APNS_TEAM_ID" | "APNS_HOST">;

export const apnsConfigured = (env: ApnsEnv) => !!(env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID);

let cached: { jwt: string; keyId: string; at: number } | null = null;

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** The provider token APNs expects in the authorization header. */
export async function apnsJwt(env: ApnsEnv, now = Date.now()): Promise<string> {
  if (cached && cached.keyId === env.APNS_KEY_ID && now - cached.at < 50 * 60_000) return cached.jwt;
  const pem = env.APNS_KEY!.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ alg: "ES256", kid: env.APNS_KEY_ID })));
  const body = b64url(enc.encode(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: Math.floor(now / 1000) })));
  // WebCrypto gives the raw r||s signature, which is what JWS wants.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`));
  const jwt = `${head}.${body}.${b64url(sig)}`;
  cached = { jwt, keyId: env.APNS_KEY_ID!, at: now };
  return jwt;
}

export interface LiveActivityPush {
  token: string;
  aps: Record<string, unknown>;
  /** 10: show now (spends iOS's per-phone budget). 5: when convenient. */
  priority: 5 | 10;
}

/**
 * Sends ActivityKit pushes. Returns the tokens Apple says are dead (app removed,
 * activity gone) so the caller can forget them.
 */
export async function sendLiveActivityPushes(env: ApnsEnv, pushes: LiveActivityPush[], fetcher: typeof fetch = fetch): Promise<{ sent: number; dead: string[] }> {
  if (!apnsConfigured(env) || pushes.length === 0) return { sent: 0, dead: [] };
  const host = env.APNS_HOST || "api.push.apple.com";
  const jwt = await apnsJwt(env);
  const dead: string[] = [];
  let sent = 0;
  await Promise.all(
    pushes.map(async (p) => {
      try {
        const res = await fetcher(`https://${host}/3/device/${p.token}`, {
          method: "POST",
          headers: {
            authorization: `bearer ${jwt}`,
            "apns-push-type": "liveactivity",
            "apns-topic": `${BUNDLE_ID}.push-type.liveactivity`,
            "apns-priority": String(p.priority),
            "content-type": "application/json",
          },
          body: JSON.stringify({ aps: p.aps }),
        });
        if (res.ok) return void sent++;
        const reason = ((await res.json().catch(() => ({}))) as { reason?: string }).reason ?? "";
        if (res.status === 410 || reason === "BadDeviceToken" || reason === "Unregistered") dead.push(p.token);
        else console.error("APNs live activity push failed", res.status, reason);
      } catch (err) {
        console.error("APNs request failed", err);
      }
    }),
  );
  return { sent, dead };
}

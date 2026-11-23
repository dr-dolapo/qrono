/**
 * Adds the runtime version to app.json's config. It decides which installed apps
 * an over-the-air update (EAS Update) may be sent to:
 *
 *  - Real builds (TestFlight, Play, the Android APK) use a fingerprint of the app's
 *    native code. An update only reaches builds with the same native code, so a change
 *    that needs new native code (a new Expo module, say) waits for a new build
 *    instead of crashing old ones.
 *  - Expo Go can only open updates made for its SDK version, so the PR previews and
 *    the "main" channel set QRONO_EXPO_GO=1 when they publish.
 */
module.exports = ({ config }) => ({
  ...config,
  runtimeVersion: process.env.QRONO_EXPO_GO === "1" ? { policy: "sdkVersion" } : { policy: "fingerprint" },
});

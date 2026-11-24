# qrono-mobile

The Qrono participant app for iOS and Android, built with React Native and [Expo](https://docs.expo.dev/) (TypeScript).

## Try it on your phone (no terminal needed)

### The latest app: scan once

<img src="https://qr.expo.dev/eas-update?projectId=31a3c6e8-b533-445a-ba52-77d9b7fe0f67&runtimeVersion=exposdk%3A58.0.0&channel=main" width="200" height="200" alt="QR code that opens the latest Qrono app in Expo Go" />

Scan this with your phone's camera (iPhone) or Expo Go (Android). It always opens
the **latest version merged to `main`**, so after the first scan just reopen Qrono
from Expo Go's home screen. If a merge happened in the last few minutes, close the
app fully and reopen it to get the newest version.

This code is tied to Expo SDK 58. After an Expo upgrade, update `runtimeVersion` in
the link (`exposdk%3A<version>`) and scan once more.

### Testing a pull request

Every pull request that changes the app gets a comment with its own **QR code**. Install
**Expo Go** from the App Store or Play Store, scan the code with your phone's camera
(iPhone) or with Expo Go (Android), and the app opens with that pull request's changes.
That code opens that pull request's version only. Go back to the code above afterwards.

The app talks to the live Qrono at `https://app.qrono.co.uk`. Log in with an account
created on the web.

### How previews are set up

- Expo project **`qrono-mobile`** in the **qrono** organisation on expo.dev, linked in
  `app.json` (`owner`, `extra.eas.projectId`, `updates.url`).
- GitHub secret **`EXPO_TOKEN`**: an access token for a robot user in that organisation
  (Developer role). To replace it, create a new token on expo.dev under the organisation's
  **Access tokens** and update the secret in GitHub under **Settings → Secrets and variables → Actions**.
- The **Mobile preview** workflow (`.github/workflows/mobile-preview.yml`) publishes each
  pull request and every merge to `main`. It skips itself if the secret is missing.

## Run it from a computer (for developers)

Requirements: **Node 20+**.

```bash
cd apps/mobile
npm install
npm start          # scan the QR code with Expo Go
```

### Use your local API

The app uses the live Qrono unless `EXPO_PUBLIC_QRONO_URL` is set in `apps/mobile/.env`
(see `.env.example`). Your phone can't reach `localhost`, so make the API and web
servers visible on your Wi-Fi and use your computer's local IP:

```bash
# from the repo root, in two terminals
npm run dev:api
npm run dev -w apps/web -- --host
```

Then set `EXPO_PUBLIC_QRONO_URL=http://<your computer's IP>:5173` and restart `npm start`.

You don't need Xcode or Android Studio. The `ios/` and `android/` folders aren't
committed: Expo generates them from `app.json` when you build, so configure native
settings there instead.

```bash
npm run typecheck  # TypeScript check (also runs in CI)
npm run doctor     # Expo's project health check
```

This app is its own npm project rather than a root workspace, because React
Native needs an exact React version that differs from the web app's.

## How login works

The web app keeps its session in a browser cookie. The app logs in with the
`X-Qrono-Client: mobile` header instead, so the API returns a session token rather
than setting a cookie. The app stores that token in the iOS Keychain / Android
Keystore (`expo-secure-store`) and sends it as `Authorization: Bearer <token>`.
Sign-up and setting a new password happen on the web (PRD §1.1), so the app opens
those pages in the browser.

## Code layout

| Path | What's there |
|---|---|
| `src/app/` | Screens. Every file is a route ([Expo Router](https://docs.expo.dev/router/introduction/)); `_layout.tsx` decides which screens a signed-out or signed-in user can reach |
| `src/auth/` | The login state (`AuthProvider`) |
| `src/lib/api.ts` | Calls to the Qrono API |
| `src/components/` | Shared UI: buttons, text fields, screen wrapper |
| `src/theme.ts` | Colours and spacing |

You don't need Xcode or Android Studio for day-to-day work. The `ios/` and
`android/` folders aren't committed: Expo generates them from `app.json` when
you build, so configure native settings there instead.

```bash
npm run typecheck  # TypeScript check (also runs in CI)
npm run doctor     # Expo's project health check
```

This app is its own npm project rather than a root workspace, because React
Native needs an exact React version that differs from the web app's.

## Build and release (EAS)

Real builds of the app are made on Expo's servers. Push notifications only work in a
real build, not in Expo Go.

### Start a build (no terminal)

On GitHub, go to **Actions → Mobile build → Run workflow**, then choose:

| Platform | Profile | What you get |
|---|---|---|
| `android` | `preview` | An APK to install straight onto Android phones. The download link and QR code are on expo.dev under **Builds**. |
| `android` | `production` | An App Bundle for Google Play. |
| `ios` | `production` | An iPhone build, uploaded to App Store Connect automatically. It appears in **TestFlight** about 15 minutes after the build finishes. |

The job starts the build and finishes. The build itself takes about 10–20 minutes on
expo.dev. Store builds point at `https://app.qrono.co.uk` (set per profile in `eas.json`).

### Updates without reinstalling

Every merge to `main` that changes the app is published as an over-the-air update to
installed builds. The app downloads it in the background (on launch and whenever it
comes back to the foreground) and shows **"A new version of Qrono is ready. Restart"**.

An update only reaches builds made from the **same native code**. The runtime version
is a fingerprint of the native parts (see `app.config.js`). If a change adds or upgrades
a native module, older builds don't get it: run **Mobile build** again and install the
new build. To check, compare the runtime version on an update and a build on expo.dev.

> Before the public App Store / Play launch, consider releasing `production` updates by
> hand instead of on every merge, so testers see changes before customers do.

### One-time setup

**Android**
- `google-services.json` (Firebase project `qrono-fd89f`) is in this folder. It
  identifies the app to Firebase and isn't a secret.
- Upload the Firebase **service account key** (Firebase → Project settings → Service
  accounts → Generate new private key) on expo.dev: **project → Credentials → Android →
  FCM V1 service account key**. It is a secret: never commit it.
- The first Android build creates the app's signing key on Expo's servers.

**iOS** (needs Admin access on the Apple Developer account)
1. In App Store Connect, create the app: name **Qrono**, bundle ID `uk.co.qrono.app`. Done:
   Apple ID `6838359617`, team `56U8M8Y68H` (both in `eas.json`).
2. **App Store Connect API key** with **Admin** access (Users and Access → Integrations).
   Add it to GitHub under **Settings → Secrets and variables → Actions**:
   - secrets: `ASC_API_KEY_P8` (the whole `.p8` file), `ASC_KEY_ID`, `ASC_ISSUER_ID`
   - variable: `APPLE_TEAM_ID`
3. **Apple Push Notifications key** (Certificates, Identifiers & Profiles → Keys). After the
   first iOS build has created `uk.co.qrono.app` on expo.dev, upload the `.p8` there under
   **project → Credentials → iOS → uk.co.qrono.app → Push Notifications**.
4. In TestFlight, add yourself and your team as **internal testers** to install builds.

### From a computer (for developers)

```bash
npm install -g eas-cli
eas build --profile preview --platform android
eas submit --platform all          # upload the latest store builds
eas update --channel production    # a JavaScript-only fix to installed store builds
```

## App icon

The icons in `assets/` are exported from the masters in [`docs/brand/icon`](../../docs/brand/icon).

### When the iPhone app gains an extension (e.g. the Live Activity widget)

Store builds can reuse signing credentials but not create them. After adding an extension,
or changing an App ID's capabilities:

1. Apple Developer → Certificates, IDs & Profiles → Identifiers. App Groups can't be set
   with the API key, so do it by hand: create the App Group `group.uk.co.qrono.app`, then
   on both `uk.co.qrono.app` and `uk.co.qrono.app.ExpoWidgetsTarget` tick **App Groups**,
   choose that group and save.
2. GitHub → Actions → **iOS credentials** → Run workflow.
3. Run **Mobile build** again.

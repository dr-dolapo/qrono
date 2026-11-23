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

Builds run in Expo's cloud, so iOS builds don't need a Mac. One-time setup:

```bash
npm install -g eas-cli
eas login
eas init           # links the app to your Expo account
```

| Command | What it makes |
|---|---|
| `eas build --profile development` | A development build, needed once the app uses native modules that Expo Go doesn't include |
| `eas build --profile preview` | An installable build to share with testers |
| `eas build --profile production --platform all` | Store builds for iOS and Android together |
| `eas submit --platform all` | Uploads the latest store builds to App Store Connect and Google Play |
| `eas update` | Sends a JavaScript-only fix to installed apps, with no store review |

Store builds point at `https://app.qrono.co.uk` (set per profile in `eas.json`).

> **Check the bundle ID before the first release.** `app.json` uses
> `uk.co.qrono.app` (from the qrono.co.uk domain) for both stores. It can't be
> changed after the app is published.

## App icon

The icons in `assets/` are exported from the masters in [`docs/brand/icon`](../../docs/brand/icon).

## Planned packages

Add them with `npx expo install <package>` so the versions match the Expo SDK.

| Need | Package |
|---|---|
| Push notifications (broadcasts, with Acknowledge / Snooze / Done actions) | `expo-notifications` |
| Live agenda over WebSocket | built-in `WebSocket` |

# qrono-mobile

The Qrono participant app for iOS and Android, built with React Native and [Expo](https://docs.expo.dev/) (TypeScript).

## Run it

Requirements: **Node 20+** and the **Expo Go** app on your phone (App Store or Play Store).

```bash
cd apps/mobile
npm install
cp .env.example .env   # then set EXPO_PUBLIC_QRONO_URL (see below)
npm start              # then scan the QR code with your phone's camera (iOS) or Expo Go (Android)
```

### Which Qrono the app talks to

`EXPO_PUBLIC_QRONO_URL` in `apps/mobile/.env` is the Qrono web address. The API is
under `/api` on the same address. Restart `npm start` after you change it.

- **Your deployed Qrono** (easiest): the address you open in the browser, e.g.
  `https://qrono-web.<your-subdomain>.workers.dev`. Log in with an account you
  created on the web.
- **Your local API**: your phone can't reach `localhost`, so start the API and
  web servers so they're visible on your Wi-Fi, then use your computer's local IP:

  ```bash
  # from the repo root, in two terminals
  npm run dev:api
  npm run dev -w apps/web -- --host
  ```

  Then set `EXPO_PUBLIC_QRONO_URL=http://<your computer's IP>:5173`. Your phone and
  computer must be on the same Wi-Fi.

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

Before the first build, set `EXPO_PUBLIC_QRONO_URL` for each profile in
`eas.json` (under `"env"`), since `.env` isn't used for cloud builds.

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

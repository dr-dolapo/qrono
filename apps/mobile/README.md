# qrono-mobile

The Qrono participant app for iOS and Android, built with React Native and [Expo](https://docs.expo.dev/) (TypeScript).

## Try it on your phone (no terminal needed)

Every pull request that changes the app gets a comment with a **QR code**. Install
**Expo Go** from the App Store or Play Store, scan the code with your phone's camera
(iPhone) or with Expo Go (Android), and the app opens with that pull request's changes.
Each merge to `main` publishes too.

The app talks to the live Qrono at `https://app.qrono.co.uk`. Log in with an account
created on the web.

### Previews: one-time setup (all in the browser)

1. **Expo account:** sign up at [expo.dev](https://expo.dev).
2. **Expo project:** done. The project `qrono-mobile` is linked in `app.json`
   (`expo.extra.eas.projectId` and `expo.updates.url`).
3. **Access token:** on expo.dev, go to **Account settings → Access tokens → Create token**.
4. **GitHub secret:** in this repo on GitHub, go to **Settings → Secrets and variables →
   Actions → New repository secret**, named `EXPO_TOKEN`, with the token as its value.

Until step 4 is done, the **Mobile preview** workflow skips itself.

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

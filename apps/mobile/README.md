# qrono-mobile

The Qrono participant app for iOS and Android, built with React Native and [Expo](https://docs.expo.dev/) (TypeScript).

## Run it

Requirements: **Node 20+** and the **Expo Go** app on your phone (App Store or Play Store).

```bash
cd apps/mobile
npm install
npm start          # then scan the QR code with your phone's camera (iOS) or Expo Go (Android)
```

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
| Screens and navigation | `expo-router` |
| Live agenda over WebSocket | built-in `WebSocket` |
| Secure session storage | `expo-secure-store` |

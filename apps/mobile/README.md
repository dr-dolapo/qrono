# qrono_mobile

The Qrono participant app for iOS and Android, built with Flutter.

## First-time setup

The repo holds only the Dart code (`lib/`, `test/`, `pubspec.yaml`). Generate
the iOS and Android project folders once on your machine:

```bash
cd apps/mobile
flutter create . --org com.qrono --project-name qrono_mobile --platforms=ios,android
flutter pub get
dart run flutter_launcher_icons   # app icon, from assets/icon/
flutter test
flutter run
```

`flutter create .` keeps the existing `lib/main.dart` and `pubspec.yaml`. Commit
the generated `ios/` and `android/` folders afterwards.

> **Check the org ID first.** `com.qrono` becomes the app's bundle ID on the
> App Store and Play Store, and it can't be changed after the first release.
> Use a domain you own, e.g. `com.yourcompany.qrono`.

## Planned packages

| Need | Package |
|---|---|
| Push notifications (broadcasts) | `firebase_messaging` |
| Live agenda over WebSocket | `web_socket_channel` |
| API calls | `http` or `dio` |
| Secure session storage | `flutter_secure_storage` |

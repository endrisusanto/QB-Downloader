# QB Dashboard — Android App

Kotlin Jetpack Compose app that mirrors the web dashboard with remote download control.

## Requirements
- Android Studio Hedgehog (2023.1.1) or newer
- Android SDK 35
- JDK 17+

## Setup

1. **Open in Android Studio**: `File → Open` → select this `android/` folder.
2. Let Gradle sync finish (downloads deps automatically).
3. Build & run on device or emulator (API 26+).

## First launch
1. Tap the **Settings ⚙** icon in the top bar.
2. Enter your **Server URL** (e.g. `https://qd.endrisusanto.my.id`).
3. Enter **API Key** if configured (leave empty otherwise).
4. Tap **Save & Connect** — the badge turns green when connected.

## Features
- **PC list** — all connected Windows PCs with online/offline status badges.
- **PC detail** — tap a PC card to see live download progress.
- **Remote download** — tap "Remote Download" on any online PC, enter a QB Build ID, select artifact types, and hit Start.
- **Auto-reconnect** — reconnects every 5 seconds if the server drops.

## Building APK for distribution
```bash
cd android
./gradlew assembleRelease
# APK at: app/build/outputs/apk/release/app-release-unsigned.apk
```
Sign with your keystore before distribution.

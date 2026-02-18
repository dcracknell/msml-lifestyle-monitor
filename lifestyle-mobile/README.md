# MSML Lifestyle Mobile (React Native)

A React Native + Expo client that mirrors the MSML Lifestyle dashboard so athletes and coaches can monitor readiness, vitals, nutrition, activity, and roster insights from mobile devices. The app consumes the existing Express/SQLite API that powers the `lifestyle-web` project and adds an offline-aware mutation queue so logs can be captured without connectivity.

## Requirements

- Node.js 20 or 22 LTS (use `.nvmrc`)
- npm or yarn
- Expo CLI (`npx expo` is sufficient)

## Getting started

```bash
cd lifestyle-mobile
cp .env.example .env            # update API URLs
npm install                     # installs Expo + React Native deps
npm run start                   # launches Expo dev server
```

The default `.env.example` points the app at `https://www.msmls.org`. If you’re testing against a local server, override `EXPO_PUBLIC_API_BASE_URL` (and `EXPO_PUBLIC_WEB_APP_ORIGIN`) with your LAN URL.

## Feature parity

The mobile app implements the same major surfaces as the web UI:

- **Authentication + password reset** using the `/api/login`, `/api/signup`, and `/api/password` routes.
- **Overview dashboard** with readiness ring, hydration, macro targets, and timeline charts from `/api/metrics`.
- **Activity + Sessions** with Strava connectivity plus best efforts, recent workouts, split breakdowns, and the same mileage/training-load/pace charts from `/api/activity`.
- **Coach subject switching** mirrors the web dashboard with the "My dashboard" chip and roster stats so coaches can bounce between themselves and linked athletes.
- **Vitals** 14‑day trends and latest readings from `/api/vitals`.
- **Nutrition** day selector, collapsible macro targets/log entry forms with barcode + weight-aware inputs (with offline queue), and monthly trends from `/api/nutrition`.
- **Weight** logging and trends with offline queue via `/api/weight`.
- **Roster + Sharing** for coaches using `/api/athletes` and `/api/share`.
- **Profile + Admin** for updating account details and managing roles via `/api/profile` and `/api/admin`.
- **Devices (Bluetooth bridge)** scans for BLE peripherals, subscribes to sensor characteristics, streams samples to `/api/streams`, and exposes manual command/sample testing tools.
- **Navigation + auth** mirrors the responsive web dashboard with a visible drawer toggle and logout action so switching pages/accounts works the same way.
- **Profile photos** snap a picture during signup or from Profile, syncing the avatar (or URL) directly to the shared user record.

Subject switching is available to coaches so they can view linked athletes just like the browser experience.

## Offline sync queue

Mutations that write data (weight logs, nutrition entries) route through `SyncProvider`, which:

1. Tries the network immediately using the active auth token.
2. Falls back to persisting the request (endpoint, payload, description) in AsyncStorage when offline.
3. Replays queued mutations automatically when network connectivity returns.

React Query caches GET responses locally so previously viewed screens remain visible while offline.

## Project structure

```
App.tsx                # font loading + NavigationContainer
app.config.js          # Expo config + env bindings
src/
  api/                 # API client, typed endpoints, response models
  components/          # Themed UI building blocks
  features/            # Screen implementations per domain
  navigation/          # Auth stack + drawer navigator
  providers/           # Auth, subject, connectivity, sync contexts
  theme/               # Color + spacing tokens ported from styles.css
```

## Bluetooth sensor bridge

The **Devices** drawer screen lets you bridge any BLE sensor directly into the lifestyle server:

1. Enter the service + characteristic UUIDs that your peripheral exposes (defaults match the original Swift prototype: FFF0 / FFF1) and set the metric name the samples should live under (e.g. `sensor.glucose`).
2. Tap **Scan for devices**, pick the peripheral, and the app subscribes to notifications on the configured characteristic.
3. Incoming payloads are decoded to UTF‑8, parsed (JSON arrays/objects or raw numeric strings), and pushed to `/api/streams`. Uploads go through the existing `SyncProvider`, so readings queue offline and flush later if you lose connectivity.
4. Use the manual **Device command** input to send plain‑text commands (encoded to base64) back to the peripheral, or **Manual sample** to push arbitrary readings to the server for testing.
5. The screen visualizes both live samples (straight from Bluetooth) and the historical stream returned by `GET /api/streams?metric=...` so you can verify everything the server stored.

### Native build requirements

`react-native-ble-plx` is a native BLE module and cannot run inside the Expo Go sandbox. Use a development build so the module is compiled into your binary:

```bash
# Once per platform/project
npx expo prebuild

# iOS simulator / device
npx expo run:ios

# Android emulator / device
npx expo run:android
```

### Build with Xcode (installable app)

1. Install pods:
   ```bash
   cd ios
   pod install
   ```
2. Open `ios/MSMLLifestyle.xcworkspace` in Xcode (not the `.xcodeproj`).
3. In Xcode, go to `MSMLLifestyle` target -> `Signing & Capabilities`:
   - Select your Apple Developer Team.
   - Confirm Bundle Identifier is `com.msml.lifestyle` (or change to your own unique identifier).
4. Select a real iPhone device and run, or choose `Product` -> `Archive` for App Store/TestFlight distribution.

On Android 12+ the app requests the `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, and `ACCESS_FINE_LOCATION` permissions the first time you start a scan. Make sure Bluetooth is enabled and grant those prompts so discovery succeeds.

## Running on devices

The app is managed by Expo, so you can develop on any platform (no macOS required). Use the Expo Go app or `npx expo run:ios` / `npx expo run:android` when native builds are needed. All network calls go to the same API origin you configure in `.env`.

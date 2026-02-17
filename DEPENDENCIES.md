# Dependency Reference

Use this checklist when provisioning a fresh workstation or server for the MSML Lifestyle Monitor project. It captures every runtime, package, and external system required by the code that lives in this repository.

---

## 1. System Tooling & Package Managers

| Tool | Minimum Version | Why it is needed |
| --- | --- | --- |
| `git` | 2.40+ | Clone the repo and pull the `fpga` submodule defined in `.gitmodules`. |
| `Node.js` | 18.0+ (20 LTS recommended) | Express server and Strava client (`lifestyle-web/server`). Node 18 is required because `services/strava.js` relies on the global `fetch` API. |
| `npm` | 9+ | Installs the server dependencies described in `lifestyle-web/server/package.json`. Bundled with Node. |
| `python3`, `make`, `g++` (or `build-essential`) | Latest stable | Needed once during `npm install` because `better-sqlite3` builds a native addon. |
| `sqlite3` CLI + `libsqlite3` runtime | 3.40+ | Verifies/operates on the database created in `lifestyle-web/database/storage`. The Node addon links against `libsqlite3`. |
| `Rust` toolchain (cargo, rustc) | 1.72+ (optional) | Only required if you want to rebuild `lifestyle-web/server/noip-duc_3.3.0` from source; prebuilt binaries are already included. |

> **Linux quick start**  
> ```bash
> sudo apt update
> sudo apt install git build-essential python3 sqlite3
> # Install Node 20 LTS via nvm, fnm, or the official tarballs for reproducible builds.
> ```

---

## 2. Lifestyle Web Dashboard & API (`lifestyle-web/server`)

### Runtime + Database
- Node.js ≥18 and npm (see section 1).
- Writable storage at `lifestyle-web/database/storage` so that `src/db.js` can materialize `lifestyle_monitor.db` and seed it from `database/sql/lifestyle_metrics.sql` on first boot.
- Optional: `sqlite3` CLI if you want to inspect or reseed the DB manually.

### Environment file
1. Copy `lifestyle-web/server/.env.example` to `.env`.
2. Set the values listed in the example file—`PORT`, `HOST`, `APP_ORIGIN`, `SESSION_SECRET`, `DB_*` paths, and (optionally) `STRAVA_*`.

### NPM packages (installed via `npm install` inside `lifestyle-web/server`)

| Package | Version | Purpose |
| --- | --- | --- |
| `express` | ^4.19.2 | HTTP API + static file serving (`src/server.js`). |
| `cors` | ^2.8.5 | Origin filtering for the API (`src/server.js`). |
| `dotenv` | ^16.4.1 | Loads `.env` values before boot (`src/server.js`). |
| `better-sqlite3` | ^9.4.0 | File-backed SQLite database (`src/db.js`). Requires the build toolchain mentioned earlier. |

**Dev dependency**

| Package | Version | Purpose |
| --- | --- | --- |
| `nodemon` | ^3.0.2 | File-watch reload for `npm run dev`. |

### Front-end assets
- `Chart.js` is pulled from the jsDelivr CDN inside `public/index.html`. No local install is needed but outbound internet access is required the first time a browser loads the dashboard.
- Google Fonts (`Inter`, `Space Grotesk`) are also fetched from `fonts.googleapis.com`.

### Setup steps on a new machine
```bash
cd lifestyle-web/server
npm install          # installs the dependencies listed above
cp .env.example .env # adjust values as needed
npm run dev          # or npm start for production
```

---

## 3. Database Artifacts (`lifestyle-web/database`)

- `sql/lifestyle_metrics.sql` holds the schema + seed data referenced by the server. Keep it in sync if you change the database shape.
- `storage/` is intentionally empty in Git; Node populates it at runtime. Ensure whatever host you deploy on allows this directory to be writable.
- Optional: run `sqlite3 database/storage/lifestyle_monitor.db < database/sql/lifestyle_metrics.sql` if you need to reseed without starting the Node server.

---

## 4. iOS Sensor Capture App (`ios/`)

| Requirement | Version / Notes |
| --- | --- |
| macOS with Xcode | Xcode 15 (Swift 5.9) or newer is recommended to build the SwiftUI app. |
| iOS SDK | The app targets modern iOS (17 by default when opened in Xcode). |
| Frameworks | Uses SwiftUI, Combine, CoreBluetooth, Foundation, and `os.log` (see `MSMLLifestyleMonitorApp.swift` and `Services/*`). |
| Testing | Relies on `XCTest` for unit tests under `MSMLLifestyleMonitorTests`. |
| Hardware | A Bluetooth Low Energy peripheral that exposes service `0xFFF0` and characteristic `0xFFF1`, plus a reachable MQTT broker (default URI lives in `MSMLLifestyleMonitorApp.swift`). |

Setup flow:
1. Open the `ios` folder in Xcode (create a workspace or project if you have not already generated one).
2. Update the MQTT broker URL, topic, and BLE UUIDs in `MSMLLifestyleMonitorApp.swift` to match your hardware.
3. Run on an iOS device with BLE enabled and the MQTT broker accessible over the network.

---

## 5. Optional / External Services

- **Strava API credentials** – Required for `/api/activity/strava/*` routes. Set `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REDIRECT_URI`, and `STRAVA_SCOPE` in `.env` (see `src/services/strava.js`).
- **MQTT broker** – Needed only if you use the iOS data pipeline; point the app at an existing broker such as Mosquitto or EMQX.
- **Dynamic DNS (`noip-duc`)** – `lifestyle-web/server/noip-duc_3.3.0` contains No-IP’s Dynamic Update Client (prebuilt `.deb`/`.gz` packages plus Rust sources). Install one of the binaries or rebuild with Cargo if you intend to expose the server over a residential ISP.
- **FPGA submodule** – Run `git submodule update --init --recursive` if you need the FPGA reference designs. Toolchain requirements (e.g., Xilinx Vivado) live inside that submodule’s repository (`fpga-msml-lifestyle-monitor`).

With the prerequisites above installed, you can clone the repository on any machine, run `npm install` inside `lifestyle-web/server`, prepare the `.env`, and immediately boot the dashboard or continue work on the iOS capture app.

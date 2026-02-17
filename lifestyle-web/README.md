# Lifestyle Web Dashboard

## Overview
Lifestyle Web Dashboard is the browser-based companion to the MSML Lifestyle Monitor program. It gives athletes, coaches, and head coaches a Fitbit-style cockpit that keeps telemetry, accountability, and access control in one place. Web, iOS, Android, and wearables all authenticate against this single API, so every client gets the exact same roles, sharing rules, and data model.

### Why it exists
- **Unified data surface:** The Express.js API is the central clearing house for login, telemetry ingestion, and Strava sync, which keeps satellite apps lightweight.
- **Coach-friendly control:** Trainers see ranked leaderboards, can hop into linked athlete dashboards, and retain the power to reset passwords or manage roles without touching SQL.
- **Deterministic demos:** A versioned SQLite seed provides twelve months of synthetic metrics so every reset yields a rich dashboard for demos, tests, and regression checks.

### Experience at a glance
1. Athlete signs up via the web UI (or any MSML client) and immediately sees empty cards explaining that telemetry hasn’t synced yet.
2. They invite a coach by email, choose an avatar, and optionally drop Strava credentials so the Activity tab can backfill workouts.
3. Coaches/head coaches see a leaderboard, switch into athlete dashboards, and nudge progress with ready-made charts and summaries.

### Architecture snapshot
```
Browsers / Mobile / Wearables
            │ HTTPS + token auth
            ▼
    Express.js API (server/src)
            │ SQLite + Strava bridge
            ▼
  database/storage/lifestyle_monitor.db
```

### Data & security posture
| Area | Details |
| --- | --- |
| Authentication | Email + password with AES-256-GCM session tokens shared across web/mobile clients. |
| Roles | Head coach > coach > athlete hierarchy enforced at the API layer via `coach_athlete_links`. |
| Telemetry | `/api/streams` ingests high-frequency samples, deduplicates by `(user_id, metric, timestamp)`, and down-samples responses. |
| Secrets | `.env` plus per-athlete Strava credentials stored in SQLite. HTTPS enforcement available via `REQUIRE_HTTPS`. |

## Feature Highlights

### Access & identity
- Inline email/password signup that accepts full email, name, or email handle at login.
- Avatar picker and coach invite during onboarding.
- Profile screen lets users update display name, email, and password after confirming the current password.
- AES-256-GCM encrypted password digests plus signed session tokens.

### Coaching & collaboration
- Leaderboard ranks every athlete visible to a coach or head coach.
- Head coaches can promote/demote members, reset passwords (to `Password` or a temporary value), or delete inactive accounts.
- `/api/share` and Share Data panel let athletes link or revoke coaches without DBA assistance.

### Telemetry & insights
- Responsive dashboard styled with gradients, glassmorphism, and Fitbit-inspired typography.
- Activity Tracking page mirrors Garmin/Apple Watch UX with charts, splits, and Strava importing.
- Metric aggregation endpoints power summary cards, readiness timelines, hydration graphs, macro targets, and more.
- Web Bluetooth bridge pipes wearable data directly into `/api/streams` for rapid prototyping.

### Admin & ops
- Optional HTTPS enforcement, sanitized auth responses, and Strava secret storage on the server only.
- Dockerfile + Compose stack, `.env` driven config, and reset scripts for reproducible environments.
- Metrics filters (`include` query) let clients request only the sections they need (`summary`, `timeline`, `hydration`, etc.).

## Project Layout
```
lifestyle-web/
├── README.md
├── database
│   ├── sql
│   │   └── lifestyle_metrics.sql   # Schema + baseline data ingested on boot
│   └── storage/                    # SQLite DB file is created here at runtime
└── server
    ├── public                      # Vanilla JS + Chart.js powered UI
    │   ├── app.js
    │   ├── index.html
    │   └── styles.css
    └── src
        ├── routes
        │   ├── activity.js
        │   ├── admin.js
        │   ├── athletes.js
        │   ├── auth.js
        │   ├── metrics.js
        │   ├── share.js
        │   └── signup.js
        ├── services
        │   ├── session-store.js
        │   └── strava.js
        ├── utils
        │   ├── crypto.js
        │   ├── load-sql.js
        │   └── role.js
        ├── db.js
        └── server.js
```

## Local Development
```bash
cd lifestyle-web/server
npm install
npm run dev
```
The server reads environment variables from `.env` (copy from `.env.example`). By default it listens on `http://localhost:4000` and hot-reloads backend + frontend assets.

## Configuration
| Name | Description | Default |
| --- | --- | --- |
| `PORT` | HTTP port | `4000` |
| `HOST` | Interface the server binds to | `0.0.0.0` |
| `APP_ORIGIN` | Comma-separated list of allowed origins for CORS | `http://localhost:4000` |
| `API_BODY_LIMIT` | Max size for JSON/form payloads (supports avatar uploads) | `6mb` |
| `REQUIRE_HTTPS` | When `true`, redirects HTTP GET/HEAD requests to HTTPS and rejects insecure mutations. Set this once TLS terminates in a proxy that forwards `X-Forwarded-Proto`. | `false` |
| `STREAM_MAX_BATCH` | Max samples accepted per `/api/streams` ingestion request | `2000` |
| `STREAM_MAX_POINTS` | Max downsampled points returned per `/api/streams` read | `600` |
| `STREAM_DEFAULT_WINDOW_MS` | Default lookback window when `from` isn’t provided | `21600000` (6 hours) |
| `SESSION_TTL_HOURS` | Session lifetime | `12` |
| `SESSION_SECRET` | Secret used to derive AES-256-GCM key for tokens | `msml-lifestyle-monitor` |
| `PASSWORD_ENCRYPTION_KEY` | Secret used to derive the AES-256-GCM key that encrypts stored password digests | `msml-lifestyle-monitor-passwords` |
| `DB_STORAGE_DIR` | Optional override for writable SQLite directory | `./database/storage` |
| `DB_SQL_DIR` | Optional override for SQL seed directory | `./database/sql` |
| `HEAD_COACH_SEED_PASSWORD` | Optional override for the head coach password baked into the SQL seed | `Password` |
| `COACH_SEED_PASSWORD` | Optional override for the coach password baked into the SQL seed | `Password` |
| `ATHLETE_SEED_PASSWORD` | Optional override for the athlete password baked into the SQL seed | `Password` |
| `STRAVA_CLIENT_ID` | OAuth client ID from https://www.strava.com/settings/api | — |
| `STRAVA_CLIENT_SECRET` | OAuth client secret from Strava | — |
| `STRAVA_REDIRECT_URI` | HTTPS URL that Strava should redirect back to (must end with `/api/activity/strava/callback`) | — |
| `STRAVA_SCOPE` | Optional scope override for Strava requests | `read,activity:read_all` |

These environment variables act as fallbacks for deployments that manage one shared Strava application. Individual athletes can store their own client credentials under **Profile → Strava connection keys**.

## Deployment Options
### Docker Image
1. Copy `lifestyle-web/server/.env.example` to `lifestyle-web/server/.env` and set unique secrets (`SESSION_SECRET`, `PASSWORD_ENCRYPTION_KEY`, etc.). Any values omitted fall back to the defaults above.
2. Build the image from the repository root (Docker context is `lifestyle-web/`):
   ```bash
   docker build -t lifestyle-web -f lifestyle-web/Dockerfile lifestyle-web
   ```
3. Launch the container, binding a volume for `database/storage` so SQLite survives restarts:
   ```bash
   docker run --env-file lifestyle-web/server/.env \
     -p 4000:4000 \
     -v lifestyle-web-db:/app/lifestyle-web/database/storage \
     --name lifestyle-web \
     lifestyle-web
   ```
   - Remove or change `-p 4000:4000` when reverse proxying behind nginx/Caddy/Traefik.
   - Reset all data by stopping the container and deleting the `lifestyle-web-db` volume (`docker volume rm lifestyle-web-db`).

### Docker Compose
Prefer Compose for iterative dev/prod parity. From `lifestyle-web/` run:
```bash
docker compose up --build -d
```
Compose uses the same named volume to persist SQLite, rebuilds when files change, and watches `server/.env` for configuration overrides. Inspect logs with `docker compose logs -f lifestyle-web`.

### Serving Beyond Localhost
1. Copy `.env.example` to `.env` and set `HOST=0.0.0.0` plus your preferred `PORT`.
2. Update `APP_ORIGIN` with every public URL you expect browsers to load from (include both apex and `www` domains if relevant). Set `APP_ORIGIN=*` only if you explicitly want any origin.
3. Expose the chosen TCP port in your firewall/router. When fronting with HTTPS, point your reverse proxy at `http://127.0.0.1:PORT` and include the public HTTPS origin in `APP_ORIGIN`.
4. Restart the server (`npm run start` or your process manager) and verify an external request works with `curl http://<public-host>:PORT/api/health`.

## Operating the Platform
### Resetting the Seed Database
When you edit `database/sql/lifestyle_metrics.sql` or want a clean slate:
```bash
cd lifestyle-web/server
npm run reset-db
```
This deletes `database/storage/lifestyle_monitor.db*`, replays the SQL seed, and reapplies runtime migrations defined in `src/db.js`.

### Metrics payload filters
`GET /api/metrics` accepts an `include` query parameter so clients can pull only the sections they need: `summary`, `timeline`, `macros`, `heartRate`, `hydration`, `sleepStages`, and/or `readiness`.
- `GET /api/metrics?include=summary,readiness` returns the key cards plus readiness trend.
- `GET /api/metrics?athleteId=2&include=timeline,hydration` lets a coach fetch just the datasets they plan to graph.
If `include` is omitted or invalid, the endpoint returns every section.

### Real-time telemetry ingestion
- **Ingest:** `POST /api/streams` with a JSON body like:
  ```json
  {
    "metric": "heart_rate",
    "samples": [
      { "timestamp": 1710612345123, "value": 142 },
      { "timestamp": 1710612346123, "value": 143 }
    ]
  }
  ```
  The request uses the authenticated athlete’s ID, accepts up to `STREAM_MAX_BATCH` samples, and deduplicates by `(user_id, metric, timestamp)` so retrying uploads is safe.
- **Read:** `GET /api/streams?metric=heart_rate&from=1710612000000&to=1710615600000&maxPoints=300` slices the requested window, down-samples to the requested (bounded) number of points, and returns `{ points, total, from, to }`. Coaches/head coaches can add `athleteId` to review linked athletes.
- **Web Bluetooth bridge:** Open `/bluetooth.html` (after signing in) to pair directly with a BLE device. The page parses your chosen measurement type and forwards buffered samples into `/api/streams`.

### Strava Linking
1. Create a Strava developer application (https://www.strava.com/settings/api) and set the authorization callback URL to `https://your-domain/api/activity/strava/callback`.
2. Sign in, open **Profile → Strava connection keys**, and paste your client ID, client secret, and redirect URL. These credentials are stored privately against your account.
3. Restart `npm run dev` if you changed server-side env vars (Node.js 18+ recommended for built-in `fetch`).
4. Navigate to the Activity tab, click **Connect Strava**, authorize the Lifestyle app, then use **Sync latest** whenever you want to pull workouts (distance, pace, HR, training load, splits).

### Password Storage
- Passwords are converted to a SHA-256 digest and then encrypted with AES-256-GCM using `PASSWORD_ENCRYPTION_KEY`. The resulting value (`iv:authTag:ciphertext`) is what gets persisted in SQLite.
- Changing `PASSWORD_ENCRYPTION_KEY` after users exist invalidates their hashes. Rotate the key only when you plan to reset everyone’s password or replace the SQLite file.

## Next Steps
- Hook the `ios/` app (or any other client) to `/api/login`, `/api/signup`, `/api/athletes`, `/api/share`, `/api/admin`, `/api/profile`, `/api/password/*`, and `/api/metrics`.
- Replace the seed SQL file with production ingests or a live telemetry pipeline.
- Extend the metrics route with additional tables when new sensors come online.
- If you previously ran the project, delete `database/storage/lifestyle_monitor.db` once so the updated seed (roles, links, and head coach account) can be recreated.

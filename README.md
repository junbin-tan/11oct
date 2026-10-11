# GPS Tag

A small phone game of infection tag. One player starts as the catcher. Catchers scan a runner’s QR code, or enter a short code, and that runner becomes a catcher too. A north-up radar covers 500 metres and refreshes about every five seconds. The separate Map button opens a full-screen street map showing everyone in the active game, including players beyond 500 metres.

The app is one Node process: a React interface and a Fastify API, with the game stored in SQLite.

The trial deployment is https://gps-tag-production.up.railway.app. It runs as one replica with the SQLite file on a volume mounted at `/data`.

## Play locally

```bash
npm install
npm run local
```

Open http://localhost:5173. No environment file is required. The API runs on port 3001, Vite proxies `/api`, and the database is created at `.data/game.sqlite`.

Useful checks:

```bash
npm test
npm run typecheck
npm run build
npm start
```

`npm start` serves the production build and requires `COOKIE_SECRET` when `NODE_ENV=production`.

## Phone GPS and camera

Browsers only expose location and camera on `https://` pages or `http://localhost`. A phone opening a laptop’s plain HTTP address cannot grant those permissions. Use the deployed HTTPS address for a real game.

Keep the page open and visible. Mobile browsers pause timers, GPS, and the camera when the phone locks or the tab is hidden. On return, the app fetches the current game and the next eligible radar snapshot. It does not track anyone in the background.

Location sharing stores only the latest fix. It is cleared when the round ends, and games older than 24 hours are deleted.

The browser watches location while the game is visible and uploads only the newest reading, at most once every five seconds. A quiet watch triggers a fresh acquisition after 15 seconds. Sensor frequency and accuracy are controlled by the phone; a five-second radar refresh does not guarantee a new GPS reading every five seconds. Allow roughly 12 seconds for a newly acquired reading to reach other players on a healthy connection; this is a field-test target, not a measured device guarantee.

“Location shared” means the server acknowledged the upload. Permission errors, poor accuracy, aging readings, and connection loss have separate messages. Location and radar requests time out after 10 seconds. Returning to the game starts a fresh watch; old callbacks and pending uploads are cancelled or ignored.

Radar uncertainty includes both players’ reported accuracy radii. Distances are approximate, and circles show the combined uncertainty estimate (not a statistical guarantee). If that estimate overlaps the viewer or the 500 m boundary, or accuracy/capture time is unknown, the player is listed as “Position uncertain” without a directional marker. Readings age visibly after 15 seconds and lose their directional marker after 30 seconds, including during outages. QR/code catches do not depend on GPS.

### Location protocol and upgrades

`PUT /api/game/location` accepts `{ lat, lng, accuracy, captured_at }`. Capture time is an integer epoch timestamp normalized to the server clock estimate. SQLite `captured_at` records measurement time; `location_at` remains receipt time for throttling. Upload acknowledgements include `accepted`, `reason`, `next_upload_at`, and `server_now`. Reasons are `accepted`, `throttled`, `older` (including duplicates), `expired` (over 30 seconds), and `future` (over five seconds ahead). Small positive clock differences are clamped to receipt time. Invalid types/ranges receive `INVALID_INPUT`.

Radar responses retain previous fields and add `origin_captured_at`, `origin_accuracy_m`, and per-player `captured_at`, `uncertainty_m`, and `position_uncertain`. Radar and general game-state responses do not expose absolute coordinates; the authenticated map endpoint shares fresh coordinates with members of the same active game. Legacy uploads without capture time are accepted, but their age is unknown and updated clients do not plot them precisely; older browser tabs should reload to use the improved display.

Database startup adds the capture-time column to existing installations transactionally and clears incompatible radar caches. Existing receipt timestamps are not reinterpreted as measurements. Restarting an upgraded database does not repeat the migration or erase fresh data. No manual database reset is needed.

### Full game map

The in-game **Map** button opens a street map with drag, pinch, wheel, keyboard, and +/− zoom controls. **My location** recentres on you; **Show everyone** fits all available players. The initial view fits everyone, then preserves your chosen viewport during updates. Names and role shapes identify players; your marker is blue. Accuracy circles show each phone’s reported GPS radius. Faded markers are over 15 seconds old; readings older than 30 seconds disappear even during a connection outage.

`GET /api/game/map` requires a signed player session in an active game. It returns `server_now`, `snapshot_at`, `points` (`player_id`, `lat`, `lng`, `accuracy_m`, `captured_at`), and `unavailable_player_ids`. It includes the viewer, excludes players who left, and has no distance restriction. Unknown capture times or accuracy are unavailable. No tag credentials are returned. Clients poll every five seconds only while the map is open and visible; failures retry after ten seconds. Opening the map does not start another GPS watch. No database migration is required for the map.

Street tiles use OpenStreetMap with visible attribution and normal browser caching. Only viewed tiles load; offline downloading is not supported. Tile failures leave the player overlay available with a retry control. To use another provider, set both `VITE_MAP_TILE_URL` (with `{z}/{x}/{y}` placeholders) and `VITE_MAP_TILE_ATTRIBUTION` before building. The default provider is best-effort; follow its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

### Hybrid app roadmap

The implemented release is browser GPS tracking. `src/location/provider.ts` separates sensor acquisition from upload and radar behavior so a later Capacitor app can supply native location readings using the same interface.

The separate native Bluetooth feasibility milestone will add simultaneous advertising/scanning and direct GATT exchanges on iOS and Android, with short-lived same-game identities and an expiring “Bluetooth detected nearby” hint. Both phones need native support. BLE observations will remain separate from GPS coordinates and will never automatically catch players. Browser players continue to participate using GPS. Full mesh, offline reconciliation, background tracking, app distribution, and Bluetooth distance estimates are not implemented in this release.

### Device acceptance checks

Automated tests cover timestamp/order validation, upload serialization and recovery, permission and visibility changes, uncertainty and expiration, old database migration, and a 30-player round at five-second upload/radar cadence within the existing request limits. Run the commands above before deployment.

Physical-device validation remains required: play with Safari/iPhone and Chrome/Android while stationary, walking, running, pocketed, and under weak GPS; interrupt internet; deny/revoke location permission; lock and reopen the phone; and confirm that old readings expire instead of remaining precise. Measure capture-to-display delay against the roughly 12-second target and observe battery use. Native Bluetooth pair tests belong to the later prototype milestone.

## Docker

```bash
docker compose up --build
```

The production-shaped app is at http://localhost:3000. Its database stays in the `game-data` volume, mounted at `/data`. Set `COOKIE_SECRET` in the shell to override the local Compose default. Compose sets `COOKIE_SECURE=false` because this local URL is HTTP.

## Deploy on Railway

1. Create a project from this repository. `railway.toml` selects the Dockerfile and `/health`.
2. Set `COOKIE_SECRET` to at least 32 random characters: `openssl rand -hex 32`.
3. Add one volume mounted at `/data`. The database file is `/data/game.sqlite`.
4. Keep the service at exactly one replica. SQLite on a volume cannot be shared by multiple instances.
5. Deploy and open the HTTPS URL.

Volume-backed deploys stop the old instance before the new one starts, so expect a brief interruption. Without the volume, every deploy starts with an empty database. Railway can snapshot the volume; that is the backup for a trial deployment. Do not commit a real `COOKIE_SECRET`.

The service must be reached through Railway’s public HTTPS proxy. That proxy overwrites `X-Real-IP`, which is what anonymous rate limits use. Do not add another service on the same private network that calls this port: private callers can forge that header. Direct public access to the container port is not part of the setup.

## Game rules

- The creator is the host and the first catcher.
- Other players can join only before the game starts.
- The host starts once at least two people have joined. GPS is optional; without it, a player is simply missing from the radar.
- A catcher tags a runner by QR or six-character code. The same runner cannot be scored twice.
- The game ends when no runners remain, or when the host ends it.
- Players can exit a waiting room or running game to return home and stop sharing GPS. A running game cannot be rejoined after exiting.
- When the host exits, a waiting room closes for everyone; a running game ends and the remaining players see results.
- Mid-game departures retain their earned tags in the results, labeled “Left game”, and do not count as survivors. Play ends if departures leave no runners or catchers.
- A browser can resume its game until it exits or the game ends. Exit or finish the current game before joining another.
- Refreshing resumes the signed browser session. Clearing site data starts a new player.

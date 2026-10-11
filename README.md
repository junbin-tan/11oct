# GPS Tag

A small phone game of infection tag. One player starts as the catcher. Catchers scan a runner’s QR code, or enter a short code, and that runner becomes a catcher too. A north-up radar shows players within 500 metres and refreshes about once a minute.

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
- A browser can resume its game until that game ends. It cannot join another live game first.
- Refreshing resumes the signed browser session. Clearing site data starts a new player.

# Capture the Flag

Open `/capture-the-flag` to create or join this separate mode. The original `/` game is unchanged. The creator shares the CTF room code or its dedicated invite link.

## Playing

1. Everyone joins and enables GPS. Keep the page open during play.
2. The host sets their current location as the fixed start, requests landmark suggestions, and reviews three flags. Use **Place / edit flags** when suggestions are missing or unsuitable. Tap the map to add flags; use **Move** and tap again to reposition one.
3. Confirm all three checkpoints. Their centres must be within 85 m of the start and more than 30 m apart. Everyone must be inside the 100 m boundary; the host must be within 15 m of the start.
4. The host starts a fixed 30-minute round as catcher. Runners capture by holding within 15 m of a flag for 60 continuous seconds. All flags captured wins for runners. All runners caught or time expiring wins for catchers.

Capture progress is individual, but captured flags belong to the runner team permanently. A successful QR/code tag turns a runner into a catcher. The QR prefix is `ctf:`; original-game QR codes are not accepted. Catcher proximity alone does not contest a flag. Out-of-bounds players cannot capture or initiate tags; an eligible catcher can still tag an out-of-bounds runner. Host termination and departures that make play impossible are interrupted rounds with no winner.

GPS must be no older than 10 seconds and report accuracy of 15 m or better. Capture time is credited only between qualifying server-accepted uploads, at most 10 seconds apart. The display reports verified seconds rather than awarding a capture from a local countdown. Leaving a flag, getting caught, inaccurate/stale GPS, and upload interruptions reset attempts. Captures persist through reloads; disconnected time never counts. GPS measures approximate positions, not physical proof of staying still.

## Isolation and configuration

- Separate `/api/ctf/*` routes, signed `ctf_player` cookie scoped to `/api/ctf`, `ctf_*` tables, rate-limit buckets, server timers and retention cleanup.
- No changes to original room settings, game service, database tables, migrations, GPS rules, radar configuration or screens. Existing components/utilities are reused without modification.
- Only the application selected by the URL mounts its GPS/polling hooks. Returning to `/` restores the original game session.
- New tables initialize idempotently during CTF route registration. No extra build or migration command is required.
- `CTF_OVERPASS_URL` configures the landmark endpoint (default `https://overpass-api.de/api/interpreter`). Set it to an empty string to disable lookup and use manual placement. The adapter has an 8-second request timeout, a 5-minute bounded cache including failures, and a per-player lookup rate limit. For larger deployments, configure an appropriately provisioned endpoint instead of depending on shared public service capacity.
- Landmark suggestions use named OpenStreetMap points/features and exclude explicitly restricted/indoor locations. Host review is required because map data and feature centres do not establish accessibility. OpenStreetMap attribution remains on the map.
- Active rounds expire after 30 minutes. Ended rooms are retained for 24 hours after ending; abandoned waiting rooms are removed after 24 hours. Cleanup affects CTF tables only. Live player coordinates are cleared when a round ends; checkpoint/start locations are removed with the room.

## Verification

Run `npm run typecheck`, `npm test`, and `npm run build`. CTF tests cover capture evidence, boundary enforcement, multiple runners, timing races, restart recovery, setup, sessions, rate limits, discovery failure, retention and the client flow. Existing game regression tests run unchanged.

Physical-device acceptance still requires two phones: creator setup and invite, accurate GPS at a flag for a minute, QR scan/code tag, crossing the boundary, denying GPS, interrupting the network, hiding/reopening the page, and returning to the original game. Confirm that actual nearby landmarks are suitable and that GPS accuracy supports the 15 m zones at the chosen location.

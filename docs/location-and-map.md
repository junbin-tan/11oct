# Location and map

The in-game radar is a north-up street map with a 20 metre radius (`src/radarConfig.ts`). It refreshes about every five seconds. The nearby-player list covers 500 metres. The separate Map button opens a full-screen street map of everyone in the active game, including players beyond 500 metres.

## Phone GPS

Browsers only expose location and camera on `https://` pages or `http://localhost`. A phone opening a laptop’s plain HTTP address cannot grant those permissions. Use the deployed HTTPS address for a real game.

Keep the page open and visible. Mobile browsers pause timers, GPS, and the camera when the phone locks or the tab is hidden. On return, the app fetches the current game and the next eligible radar snapshot. It does not track anyone in the background.

Location sharing stores only the latest fix. It is cleared when the round ends, and games older than 24 hours are deleted.

The browser watches location while the game is visible and uploads only the newest reading, at most once every five seconds. A quiet watch triggers a fresh acquisition after 15 seconds. Sensor frequency and accuracy are controlled by the phone; a five-second radar refresh does not guarantee a new GPS reading every five seconds. Allow roughly 12 seconds for a newly acquired reading to reach other players on a healthy connection; this is a field-test target, not a measured device guarantee.

“Location shared” means the server acknowledged the upload. Permission errors, poor accuracy, aging readings, and connection loss have separate messages. Location and radar requests time out after 10 seconds. Returning to the game starts a fresh watch; old callbacks and pending uploads are cancelled or ignored.

Radar uncertainty includes both players’ reported accuracy radii. Distances are approximate, and circles show the combined uncertainty estimate (not a statistical guarantee). If that estimate overlaps the viewer or the 500 m boundary, or accuracy/capture time is unknown, the player is listed as “Position uncertain” without a directional marker. Readings age visibly after 15 seconds and lose their directional marker after 30 seconds, including during outages. QR and code catches do not depend on GPS.

## Location protocol and upgrades

`PUT /api/game/location` accepts `{ lat, lng, accuracy, captured_at }`. Capture time is an integer epoch timestamp normalized to the server clock estimate. SQLite `captured_at` records measurement time; `location_at` remains receipt time for throttling. Upload acknowledgements include `accepted`, `reason`, `next_upload_at`, and `server_now`. Reasons are `accepted`, `throttled`, `older` (including duplicates), `expired` (over 30 seconds), and `future` (over five seconds ahead). Small positive clock differences are clamped to receipt time. Invalid types or ranges receive `INVALID_INPUT`.

Radar responses retain previous fields and add `origin_captured_at`, `origin_accuracy_m`, and per-player `captured_at`, `uncertainty_m`, and `position_uncertain`. Radar and general game-state responses do not expose absolute coordinates; the authenticated map endpoint shares fresh coordinates with members of the same active game. Legacy uploads without capture time are accepted, but their age is unknown and updated clients do not plot them precisely; older browser tabs should reload to use the improved display.

Database startup adds the capture-time column to existing installations transactionally and clears incompatible radar caches. Existing receipt timestamps are not reinterpreted as measurements. Restarting an upgraded database does not repeat the migration or erase fresh data. No manual database reset is needed.

## Full game map

The in-game **Map** button opens a street map with drag, pinch, wheel, keyboard, and +/− zoom controls. **My location** recentres on you; **Show everyone** fits all available players. The initial view fits everyone, then preserves your chosen viewport during updates. Names and role shapes identify players; your marker is blue. Accuracy circles show each phone’s reported GPS radius. Faded markers are over 15 seconds old; readings older than 30 seconds disappear even during a connection outage.

`GET /api/game/map` requires a signed player session in an active game. It returns `server_now`, `snapshot_at`, `points` (`player_id`, `lat`, `lng`, `accuracy_m`, `captured_at`), and `unavailable_player_ids`, plus `last_known_self` (the viewer’s latest stored reading or null). Fresh `points` remain separate from this fallback. The circular radar keeps your last known location with a faded, labeled marker while refreshing GPS, including after reload; other players still expire after 30 seconds. The map includes the viewer, excludes players who left, and has no distance restriction. Unknown capture times or accuracy are unavailable. No tag credentials are returned. Clients poll every five seconds only while the map is open and visible; failures retry after ten seconds. Opening the map does not start another GPS watch. No database migration is required for the map.

Street tiles use OpenStreetMap with visible attribution and normal browser caching. Only viewed tiles load; offline downloading is not supported. Tile failures leave the player overlay available with a retry control. To use another provider, set both `VITE_MAP_TILE_URL` (with `{z}/{x}/{y}` placeholders) and `VITE_MAP_TILE_ATTRIBUTION` before building. The default provider is best-effort; follow its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

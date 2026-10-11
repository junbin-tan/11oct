# Roadmap and testing

## Hybrid app roadmap

The implemented release is browser GPS tracking. `src/location/provider.ts` separates sensor acquisition from upload and radar behavior so a later Capacitor app can supply native location readings using the same interface.

The separate native Bluetooth feasibility milestone will add simultaneous advertising and scanning and direct GATT exchanges on iOS and Android, with short-lived same-game identities and an expiring “Bluetooth detected nearby” hint. Both phones need native support. BLE observations will remain separate from GPS coordinates and will never automatically catch players. Browser players continue to participate using GPS. Full mesh, offline reconciliation, background tracking, app distribution, and Bluetooth distance estimates are not implemented in this release.

## Device acceptance checks

Automated tests cover timestamp and order validation, upload serialization and recovery, permission and visibility changes, uncertainty and expiration, old database migration, and a 30-player round at five-second upload and radar cadence within the existing request limits. Before deployment, run:

```bash
npm run typecheck
npm test
npm run build
```

GitHub Actions runs the same three commands on Node 22.

Physical-device validation remains required: play with Safari on iPhone and Chrome on Android while stationary, walking, running, pocketed, and under weak GPS; interrupt internet; deny and revoke location permission; lock and reopen the phone; and confirm that old readings expire instead of remaining precise. Measure capture-to-display delay against the roughly 12-second target and observe battery use. Native Bluetooth pair tests belong to the later prototype milestone.

Capture the Flag has its own device checks in [capture-the-flag.md](capture-the-flag.md).

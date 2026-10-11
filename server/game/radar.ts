export const RADAR_RADIUS_M = 500;
export const RADAR_INTERVAL_MS = 60_000;
export const FIX_MAX_AGE_MS = 120_000;

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export interface Fix {
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  location_at: number;
}

export interface RadarPoint {
  player_id: string;
  distance_m: number;
  bearing_deg: number;
  accuracy_m: number | null;
  fix_age_s: number;
}

export interface RadarSnapshot {
  snapshot_at: number;
  origin_available: true;
  points: RadarPoint[];
  missing_gps_count: number;
  outside_range_count: number;
}

export function distanceMeters(a: Fix, b: Fix): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDegrees(a: Fix, b: Fix): number {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function isFresh(fix: { location_at: number | null }, now: number): boolean {
  return fix.location_at !== null && now - fix.location_at <= FIX_MAX_AGE_MS;
}

export function buildSnapshot(
  origin: Fix,
  others: Array<{
    id: string;
    latitude: number | null;
    longitude: number | null;
    accuracy_m: number | null;
    location_at: number | null;
  }>,
  now: number,
): RadarSnapshot {
  const points: RadarPoint[] = [];
  let missing = 0;
  let outside = 0;

  for (const other of others) {
    if (
      other.latitude === null ||
      other.longitude === null ||
      other.location_at === null ||
      !isFresh(other, now)
    ) {
      missing++;
      continue;
    }
    const fix: Fix = {
      latitude: other.latitude,
      longitude: other.longitude,
      accuracy_m: other.accuracy_m,
      location_at: other.location_at,
    };
    const distance = distanceMeters(origin, fix);
    if (distance > RADAR_RADIUS_M) {
      outside++;
      continue;
    }
    points.push({
      player_id: other.id,
      distance_m: Math.round(distance),
      bearing_deg: Math.round(bearingDegrees(origin, fix)),
      accuracy_m: fix.accuracy_m === null ? null : Math.round(fix.accuracy_m),
      fix_age_s: Math.round((now - fix.location_at) / 1000),
    });
  }

  return {
    snapshot_at: now,
    origin_available: true,
    points,
    missing_gps_count: missing,
    outside_range_count: outside,
  };
}

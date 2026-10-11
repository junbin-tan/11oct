import { isFresh } from './radar.js';

export interface MapPoint {
  player_id: string;
  lat: number;
  lng: number;
  accuracy_m: number;
  captured_at: number;
}

export interface MapResponse {
  server_now: number;
  snapshot_at: number;
  points: MapPoint[];
  unavailable_player_ids: string[];
}

export function buildMapSnapshot(players: Array<{
  id: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  captured_at: number | null;
}>, now: number): MapResponse {
  const points: MapPoint[] = [];
  const unavailable: string[] = [];
  for (const player of players) {
    if (player.latitude === null || player.longitude === null || player.accuracy_m === null ||
      player.captured_at === null || !isFresh(player, now)) {
      unavailable.push(player.id);
      continue;
    }
    points.push({ player_id: player.id, lat: player.latitude, lng: player.longitude,
      accuracy_m: player.accuracy_m, captured_at: player.captured_at });
  }
  return { server_now: now, snapshot_at: now, points, unavailable_player_ids: unavailable };
}

export type Role = 'runner' | 'catcher';
export type GameStatus = 'waiting' | 'active' | 'ended';

export interface PlayerSummary {
  id: string;
  name: string;
  role: Role;
  is_host: boolean;
  gps_ready: boolean;
  tag_count: number;
  caught_at: number | null;
}

export interface TagEvent {
  id: string;
  catcher_name: string;
  tagged_name: string;
  created_at: number;
}

export interface GameState {
  server_now: number;
  me: {
    player_id: string;
    name: string;
    role: Role;
    is_host: boolean;
    tag_code: string;
    qr_payload: string;
  };
  game: {
    code: string;
    status: GameStatus;
    host_player_id: string | null;
    created_at: number;
    started_at: number | null;
    ended_at: number | null;
  };
  players: PlayerSummary[];
  events: TagEvent[];
}

export interface RadarPoint {
  player_id: string;
  distance_m: number;
  bearing_deg: number;
  accuracy_m: number | null;
  fix_age_s: number;
}

export interface RadarResponse {
  origin_available: boolean;
  snapshot_at: number | null;
  next_ping_at: number | null;
  server_now: number;
  points: RadarPoint[];
  missing_gps_count: number;
  outside_range_count: number;
}

export interface TagResult {
  outcome: 'tagged' | 'already_tagged';
  target_name: string;
}

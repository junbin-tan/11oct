export interface Position { lat: number; lng: number }
export interface Checkpoint extends Position { id: string; name: string; captured_at: number | null; captured_by: string | null }
export type Outcome = 'flags_captured' | 'all_caught' | 'time_up' | 'interrupted';
export interface CtfState {
  server_now: number;
  game: {
    code: string; status: 'waiting' | 'active' | 'ended'; start: Position | null;
    setup_version: number; confirmed: boolean; ends_at: number | null;
    outcome: Outcome | null; winner: 'runners' | 'catchers' | null;
  };
  me: { id: string; name: string; role: 'runner' | 'catcher'; is_host: boolean; tag_code: string; qr_payload: string };
  players: Array<{
    id: string; name: string; role: 'runner' | 'catcher'; left: boolean;
    location: (Position & { accuracy: number; captured_at: number }) | null;
    eligible: boolean; gps_ready: boolean;
  }>;
  checkpoints: Checkpoint[];
  attempt: { checkpoint_id: string; elapsed_ms: number; last_received_at: number; last_captured_at: number } | null;
}
export interface Landmark extends Position { name: string }
export interface LandmarkResult { suggestions: Landmark[]; unavailable: boolean }

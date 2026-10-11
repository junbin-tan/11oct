import type { Db } from '../db.js';

/** Additive and deliberately independent of the infection game's migrations. */
export function initializeCtf(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ctf_games (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, host_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','active','ended')),
      created_at INTEGER NOT NULL, ended_at INTEGER, ends_at INTEGER,
      start_lat REAL, start_lng REAL, setup_version INTEGER NOT NULL DEFAULT 0,
      confirmed INTEGER NOT NULL DEFAULT 0,
      outcome TEXT CHECK(outcome IN ('flags_captured','all_caught','time_up','interrupted'))
    );
    CREATE TABLE IF NOT EXISTS ctf_players (
      id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES ctf_games(id) ON DELETE CASCADE,
      name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('runner','catcher')),
      tag_code TEXT NOT NULL, token TEXT NOT NULL, left_at INTEGER,
      lat REAL, lng REAL, accuracy REAL, captured_at INTEGER, received_at INTEGER,
      UNIQUE(game_id, tag_code)
    );
    CREATE INDEX IF NOT EXISTS ctf_players_game ON ctf_players(game_id);
    CREATE TABLE IF NOT EXISTS ctf_checkpoints (
      id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES ctf_games(id) ON DELETE CASCADE,
      name TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
      captured_at INTEGER, captured_by TEXT REFERENCES ctf_players(id)
    );
    CREATE INDEX IF NOT EXISTS ctf_checkpoints_game ON ctf_checkpoints(game_id);
    CREATE TABLE IF NOT EXISTS ctf_attempts (
      player_id TEXT PRIMARY KEY REFERENCES ctf_players(id) ON DELETE CASCADE,
      checkpoint_id TEXT NOT NULL REFERENCES ctf_checkpoints(id) ON DELETE CASCADE,
      elapsed_ms INTEGER NOT NULL, last_received_at INTEGER NOT NULL, last_captured_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ctf_tags (
      target_id TEXT PRIMARY KEY REFERENCES ctf_players(id) ON DELETE CASCADE,
      catcher_id TEXT NOT NULL REFERENCES ctf_players(id) ON DELETE CASCADE, created_at INTEGER NOT NULL
    );
  `);
}

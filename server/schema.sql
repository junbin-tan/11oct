CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'ended')),
  host_player_id TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 24),
  role TEXT NOT NULL CHECK (role IN ('runner', 'catcher')),
  joined_at INTEGER NOT NULL,
  caught_at INTEGER,
  tag_token TEXT NOT NULL,
  tag_code TEXT NOT NULL,
  latitude REAL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m REAL CHECK (accuracy_m >= 0),
  location_at INTEGER,
  radar_snapshot TEXT,
  radar_at INTEGER,
  UNIQUE (game_id, tag_code)
);

CREATE INDEX IF NOT EXISTS players_game_idx ON players (game_id, joined_at);

CREATE TABLE IF NOT EXISTS tag_events (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  catcher_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  tagged_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE (game_id, tagged_player_id)
);

CREATE INDEX IF NOT EXISTS tag_events_game_idx ON tag_events (game_id, created_at);

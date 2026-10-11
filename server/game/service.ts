import { timingSafeEqual } from 'node:crypto';
import type { Db } from '../db.js';
import { GameError } from '../errors.js';
import { newId, normalizeCode, randomCode, randomToken } from './codes.js';
import { buildSnapshot, isFresh, RADAR_INTERVAL_MS, type RadarSnapshot } from './radar.js';

export const MAX_PLAYERS = 30;
export const LOCATION_MIN_INTERVAL_MS = 5_000;
export const GAME_RETENTION_MS = 24 * 60 * 60 * 1000;
export const STALE_LOCATION_MS = 60 * 60 * 1000;

type Status = 'waiting' | 'active' | 'ended';
type Role = 'runner' | 'catcher';

interface GameRow {
  id: string;
  code: string;
  status: Status;
  host_player_id: string | null;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
}

interface PlayerRow {
  id: string;
  game_id: string;
  display_name: string;
  role: Role;
  joined_at: number;
  caught_at: number | null;
  tag_token: string;
  tag_code: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  location_at: number | null;
  radar_snapshot: string | null;
  radar_at: number | null;
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
    status: Status;
    host_player_id: string | null;
    created_at: number;
    started_at: number | null;
    ended_at: number | null;
  };
  players: Array<{
    id: string;
    name: string;
    role: Role;
    is_host: boolean;
    gps_ready: boolean;
    tag_count: number;
    caught_at: number | null;
  }>;
  events: Array<{
    id: string;
    catcher_name: string;
    tagged_name: string;
    created_at: number;
  }>;
}

export type RadarResponse =
  | (RadarSnapshot & { next_ping_at: number; server_now: number })
  | {
      origin_available: false;
      snapshot_at: null;
      next_ping_at: null;
      server_now: number;
      points: [];
      missing_gps_count: number;
      outside_range_count: 0;
    };

export interface LocationInput {
  lat: unknown;
  lng: unknown;
  accuracy: unknown;
}

export interface TagInput {
  payload?: unknown;
  code?: unknown;
}

export interface TagResult {
  outcome: 'tagged' | 'already_tagged';
  target_name: string;
}

export function normalizeName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 1 || name.length > 24) {
    throw new GameError('INVALID_INPUT', 'Name must be 1–24 characters.');
  }
  return name;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class GameService {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  createGame(nameInput: unknown): { playerId: string } {
    const name = normalizeName(nameInput);
    return this.db.transaction(() => {
      const now = this.now();
      const gameId = newId();
      const playerId = newId();
      const code = this.uniqueGameCode();
      this.db
        .prepare(
          `INSERT INTO games (id, code, status, host_player_id, created_at)
           VALUES (?, ?, 'waiting', ?, ?)`,
        )
        .run(gameId, code, playerId, now);
      this.insertPlayer(gameId, playerId, name, 'catcher', now);
      return { playerId };
    })();
  }

  joinGame(currentPlayerId: string | null, codeInput: unknown, nameInput: unknown): { playerId: string } {
    const code = normalizeCode(codeInput);
    if (!code) throw new GameError('INVALID_INPUT', 'Room codes are 6 characters.');
    const name = normalizeName(nameInput);

    return this.db.transaction(() => {
      const game = this.db.prepare(`SELECT * FROM games WHERE code = ?`).get(code) as GameRow | undefined;
      if (!game) throw new GameError('ROOM_NOT_FOUND', 'No game with that code.');

      if (currentPlayerId) {
        const existing = this.findPlayer(currentPlayerId);
        if (existing && existing.game_id === game.id) return { playerId: existing.id };
      }

      if (game.status === 'active') throw new GameError('ROOM_STARTED', 'That game has already started.');
      if (game.status === 'ended') throw new GameError('ROOM_ENDED', 'That game has ended.');

      const { count } = this.db
        .prepare(`SELECT COUNT(*) AS count FROM players WHERE game_id = ?`)
        .get(game.id) as { count: number };
      if (count >= MAX_PLAYERS) throw new GameError('ROOM_FULL', 'That game is full.');

      const playerId = newId();
      this.insertPlayer(game.id, playerId, name, 'runner', this.now());
      return { playerId };
    })();
  }

  getState(playerId: string): GameState | null {
    const me = this.findPlayer(playerId);
    if (!me) return null;
    const game = this.getGame(me.game_id);
    const now = this.now();

    const players = this.db
      .prepare(`SELECT * FROM players WHERE game_id = ? ORDER BY joined_at, id`)
      .all(game.id) as PlayerRow[];
    const tagCounts = new Map(
      (
        this.db
          .prepare(
            `SELECT catcher_player_id AS id, COUNT(*) AS count
             FROM tag_events WHERE game_id = ? GROUP BY catcher_player_id`,
          )
          .all(game.id) as Array<{ id: string; count: number }>
      ).map((row) => [row.id, row.count]),
    );
    const events = this.db
      .prepare(
        `SELECT e.id, c.display_name AS catcher_name, t.display_name AS tagged_name, e.created_at
         FROM tag_events e
         JOIN players c ON c.id = e.catcher_player_id
         JOIN players t ON t.id = e.tagged_player_id
         WHERE e.game_id = ?
         ORDER BY e.created_at DESC, e.id
         LIMIT 20`,
      )
      .all(game.id) as GameState['events'];

    return {
      server_now: now,
      me: {
        player_id: me.id,
        name: me.display_name,
        role: me.role,
        is_host: game.host_player_id === me.id,
        tag_code: me.tag_code,
        qr_payload: `tag:${game.code}:${me.id}:${me.tag_token}`,
      },
      game: {
        code: game.code,
        status: game.status,
        host_player_id: game.host_player_id,
        created_at: game.created_at,
        started_at: game.started_at,
        ended_at: game.ended_at,
      },
      players: players.map((p) => ({
        id: p.id,
        name: p.display_name,
        role: p.role,
        is_host: game.host_player_id === p.id,
        gps_ready: isFresh(p, now),
        tag_count: tagCounts.get(p.id) ?? 0,
        caught_at: p.caught_at,
      })),
      events,
    };
  }

  startGame(playerId: string): void {
    this.db.transaction(() => {
      const { game } = this.requireHost(playerId);
      if (game.status !== 'waiting') throw new GameError('ROOM_STARTED', 'The game has already started.');
      const { count } = this.db
        .prepare(`SELECT COUNT(*) AS count FROM players WHERE game_id = ?`)
        .get(game.id) as { count: number };
      if (count < 2) throw new GameError('NOT_ENOUGH_PLAYERS', 'You need at least two players.');

      this.db
        .prepare(
          `UPDATE players
           SET role = CASE WHEN id = ? THEN 'catcher' ELSE 'runner' END,
               caught_at = NULL, radar_snapshot = NULL, radar_at = NULL
           WHERE game_id = ?`,
        )
        .run(game.host_player_id, game.id);
      this.db
        .prepare(`UPDATE games SET status = 'active', started_at = ? WHERE id = ?`)
        .run(this.now(), game.id);
    })();
  }

  endGame(playerId: string): void {
    this.db.transaction(() => {
      const { game } = this.requireHost(playerId);
      if (game.status !== 'active') throw new GameError('GAME_NOT_ACTIVE', 'The game is not running.');
      this.finishGame(game.id);
    })();
  }

  updateLocation(playerId: string, input: LocationInput): { accepted: boolean } {
    const { lat, lng, accuracy } = input;
    if (
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      throw new GameError('INVALID_INPUT', 'Invalid coordinates.');
    }
    const accuracyM =
      accuracy === null || accuracy === undefined
        ? null
        : typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0
          ? accuracy
          : NaN;
    if (Number.isNaN(accuracyM)) throw new GameError('INVALID_INPUT', 'Invalid accuracy.');

    return this.db.transaction(() => {
      const me = this.requirePlayer(playerId);
      const game = this.getGame(me.game_id);
      if (game.status === 'ended') throw new GameError('GAME_NOT_ACTIVE', 'The game has ended.');

      const now = this.now();
      if (me.location_at !== null && now - me.location_at < LOCATION_MIN_INTERVAL_MS) {
        return { accepted: false };
      }
      this.db
        .prepare(
          `UPDATE players SET latitude = ?, longitude = ?, accuracy_m = ?, location_at = ? WHERE id = ?`,
        )
        .run(lat, lng, accuracyM, now, me.id);
      return { accepted: true };
    })();
  }

  getRadar(playerId: string): RadarResponse {
    return this.db.transaction((): RadarResponse => {
      const me = this.requirePlayer(playerId);
      const game = this.getGame(me.game_id);
      if (game.status !== 'active') throw new GameError('GAME_NOT_ACTIVE', 'The game is not running.');
      const now = this.now();

      if (me.radar_snapshot && me.radar_at !== null && now - me.radar_at < RADAR_INTERVAL_MS) {
        const snapshot = JSON.parse(me.radar_snapshot) as RadarSnapshot;
        return { ...snapshot, next_ping_at: me.radar_at + RADAR_INTERVAL_MS, server_now: now };
      }

      const others = this.db
        .prepare(`SELECT * FROM players WHERE game_id = ? AND id != ?`)
        .all(game.id, me.id) as PlayerRow[];

      if (me.latitude === null || me.longitude === null || me.location_at === null || !isFresh(me, now)) {
        return {
          origin_available: false,
          snapshot_at: null,
          next_ping_at: null,
          server_now: now,
          points: [],
          missing_gps_count: others.filter((p) => !isFresh(p, now)).length,
          outside_range_count: 0,
        };
      }

      const snapshot = buildSnapshot(
        {
          latitude: me.latitude,
          longitude: me.longitude,
          accuracy_m: me.accuracy_m,
          location_at: me.location_at,
        },
        others,
        now,
      );
      this.db
        .prepare(`UPDATE players SET radar_snapshot = ?, radar_at = ? WHERE id = ?`)
        .run(JSON.stringify(snapshot), now, me.id);
      return { ...snapshot, next_ping_at: now + RADAR_INTERVAL_MS, server_now: now };
    })();
  }

  tag(playerId: string, input: TagInput): TagResult {
    return this.db.transaction((): TagResult => {
      const me = this.requirePlayer(playerId);
      const game = this.getGame(me.game_id);
      if (game.status !== 'active') throw new GameError('GAME_NOT_ACTIVE', 'The game is not running.');
      if (me.role !== 'catcher') throw new GameError('NOT_CATCHER', 'Only catchers can tag.');

      const target = this.resolveTarget(game, input);
      if (target.id === me.id) throw new GameError('INVALID_TAG', 'You cannot tag yourself.');
      if (target.role === 'catcher') {
        return { outcome: 'already_tagged', target_name: target.display_name };
      }

      const now = this.now();
      const converted = this.db
        .prepare(`UPDATE players SET role = 'catcher', caught_at = ? WHERE id = ? AND role = 'runner'`)
        .run(now, target.id);
      if (converted.changes !== 1) {
        return { outcome: 'already_tagged', target_name: target.display_name };
      }
      this.db
        .prepare(
          `INSERT INTO tag_events (id, game_id, catcher_player_id, tagged_player_id, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(newId(), game.id, me.id, target.id, now);

      const { runners } = this.db
        .prepare(`SELECT COUNT(*) AS runners FROM players WHERE game_id = ? AND role = 'runner'`)
        .get(game.id) as { runners: number };
      if (runners === 0) this.finishGame(game.id);

      return { outcome: 'tagged', target_name: target.display_name };
    })();
  }

  cleanup(): { deletedGames: number } {
    const now = this.now();
    return this.db.transaction(() => {
      const deleted = this.db
        .prepare(`DELETE FROM games WHERE created_at < ?`)
        .run(now - GAME_RETENTION_MS);
      this.db
        .prepare(
          `UPDATE players
           SET latitude = NULL, longitude = NULL, accuracy_m = NULL, location_at = NULL,
               radar_snapshot = NULL, radar_at = NULL
           WHERE location_at < ?`,
        )
        .run(now - STALE_LOCATION_MS);
      return { deletedGames: deleted.changes };
    })();
  }

  private resolveTarget(game: GameRow, input: TagInput): PlayerRow {
    if (typeof input.payload === 'string' && input.payload.length > 0) {
      const parts = input.payload.trim().split(':');
      if (parts.length !== 4 || parts[0] !== 'tag') {
        throw new GameError('INVALID_TAG', 'That is not a player QR code.');
      }
      const [, roomCode, targetId, token] = parts as [string, string, string, string];
      if (roomCode !== game.code) throw new GameError('INVALID_TAG', 'That QR belongs to another game.');
      const target = this.db
        .prepare(`SELECT * FROM players WHERE id = ? AND game_id = ?`)
        .get(targetId, game.id) as PlayerRow | undefined;
      if (!target || !safeEqual(target.tag_token, token)) {
        throw new GameError('INVALID_TAG', 'That QR code is not valid.');
      }
      return target;
    }

    const code = normalizeCode(input.code);
    if (!code) throw new GameError('INVALID_INPUT', 'Tag codes are 6 characters.');
    const target = this.db
      .prepare(`SELECT * FROM players WHERE game_id = ? AND tag_code = ?`)
      .get(game.id, code) as PlayerRow | undefined;
    if (!target) throw new GameError('INVALID_TAG', 'No player with that tag code.');
    return target;
  }

  private finishGame(gameId: string): void {
    this.db
      .prepare(`UPDATE games SET status = 'ended', ended_at = ? WHERE id = ?`)
      .run(this.now(), gameId);
    this.db
      .prepare(
        `UPDATE players
         SET latitude = NULL, longitude = NULL, accuracy_m = NULL, location_at = NULL,
             radar_snapshot = NULL, radar_at = NULL
         WHERE game_id = ?`,
      )
      .run(gameId);
  }

  private insertPlayer(gameId: string, playerId: string, name: string, role: Role, now: number): void {
    const insert = this.db.prepare(
      `INSERT INTO players (id, game_id, display_name, role, joined_at, tag_token, tag_code)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        insert.run(playerId, gameId, name, role, now, randomToken(), randomCode());
        return;
      } catch (error) {
        if (!isUniqueViolation(error, 'players.game_id, players.tag_code')) throw error;
      }
    }
    throw new Error('Could not allocate a unique tag code.');
  }

  private uniqueGameCode(): string {
    const exists = this.db.prepare(`SELECT 1 FROM games WHERE code = ?`);
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = randomCode();
      if (!exists.get(code)) return code;
    }
    throw new Error('Could not allocate a unique room code.');
  }

  private findPlayer(playerId: string): PlayerRow | undefined {
    return this.db.prepare(`SELECT * FROM players WHERE id = ?`).get(playerId) as PlayerRow | undefined;
  }

  private requirePlayer(playerId: string): PlayerRow {
    const player = this.findPlayer(playerId);
    if (!player) throw new GameError('NOT_IN_ROOM', 'You are not in a game.');
    return player;
  }

  private getGame(gameId: string): GameRow {
    return this.db.prepare(`SELECT * FROM games WHERE id = ?`).get(gameId) as GameRow;
  }

  private requireHost(playerId: string): { me: PlayerRow; game: GameRow } {
    const me = this.requirePlayer(playerId);
    const game = this.getGame(me.game_id);
    if (game.host_player_id !== me.id) throw new GameError('HOST_ONLY', 'Only the host can do that.');
    return { me, game };
  }
}

function isUniqueViolation(error: unknown, columns: string): boolean {
  return (
    error instanceof Error &&
    (error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    error.message.includes(columns)
  );
}

import { timingSafeEqual } from 'node:crypto';
import type { Db } from '../db.js';
import { GameError } from '../errors.js';
import { newId, normalizeCode, randomCode, randomToken } from './codes.js';
import { buildMapSnapshot, type MapResponse } from './map.js';
import { buildSnapshot, hasRecentLocation, isFresh, FIX_MAX_AGE_MS, RADAR_INTERVAL_MS, type RadarSnapshot } from './radar.js';

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
  end_reason: 'host_left' | 'players_left' | 'time_up' | null;
  duration_minutes: number;
  ends_at: number | null;
}

interface PlayerRow {
  id: string;
  game_id: string;
  display_name: string;
  role: Role;
  joined_at: number;
  caught_at: number | null;
  left_at: number | null;
  tag_token: string;
  tag_code: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  location_at: number | null;
  captured_at: number | null;
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
    end_reason: 'host_left' | 'players_left' | 'time_up' | null;
    duration_minutes: number;
    ends_at: number | null;
  };
  players: Array<{
    id: string;
    name: string;
    role: Role;
    is_host: boolean;
    gps_ready: boolean;
    tag_count: number;
    caught_at: number | null;
    left_at: number | null;
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
      origin_captured_at: number | null;
      origin_accuracy_m: number | null;
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
  captured_at?: unknown;
}

export interface LocationAck {
  accepted: boolean;
  reason: 'accepted' | 'throttled' | 'older' | 'expired' | 'future';
  next_upload_at: number;
  server_now: number;
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

  createGame(nameInput: unknown, currentPlayerId: string | null = null): { playerId: string } {
    this.expireGames();
    const name = normalizeName(nameInput);
    return this.db.transaction(() => {
      this.assertCanSwitchRoom(currentPlayerId);
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
    this.expireGames();
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
      this.assertCanSwitchRoom(currentPlayerId);

      if (game.status === 'active') throw new GameError('ROOM_STARTED', 'That game has already started.');
      if (game.status === 'ended') throw new GameError('ROOM_ENDED', 'That game has ended.');

      const { count } = this.db
        .prepare(`SELECT COUNT(*) AS count FROM players WHERE game_id = ? AND left_at IS NULL`)
        .get(game.id) as { count: number };
      if (count >= MAX_PLAYERS) throw new GameError('ROOM_FULL', 'That game is full.');

      const playerId = newId();
      this.insertPlayer(game.id, playerId, name, 'runner', this.now());
      return { playerId };
    })();
  }

  getState(playerId: string): GameState | null {
    this.expireGames();
    const me = this.findPlayer(playerId);
    if (!me) return null;
    const game = this.getGame(me.game_id);
    const now = this.now();

    const players = this.db
      .prepare(`SELECT * FROM players WHERE game_id = ? AND (? = 'ended' OR left_at IS NULL) ORDER BY joined_at, rowid`)
      .all(game.id, game.status) as PlayerRow[];
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
        end_reason: game.end_reason,
        duration_minutes: game.duration_minutes,
        ends_at: game.ends_at,
      },
      players: players.map((p) => ({
        id: p.id,
        name: p.display_name,
        role: p.role,
        is_host: game.host_player_id === p.id,
        gps_ready: isFresh(p, now),
        tag_count: tagCounts.get(p.id) ?? 0,
        caught_at: p.caught_at,
        left_at: p.left_at,
      })),
      events,
    };
  }

  updateSettings(playerId: string, duration: unknown): void {
    this.expireGames();
    this.db.transaction(() => {
      const { game } = this.requireHost(playerId);
      if (game.status !== 'waiting') throw new GameError('ROOM_STARTED', 'The duration cannot change after the game starts.');
      if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 30 || duration > 360 || duration % 30 !== 0) {
        throw new GameError('INVALID_INPUT', 'Choose 30–360 minutes in 30-minute steps.');
      }
      this.db.prepare('UPDATE games SET duration_minutes = ? WHERE id = ?').run(duration, game.id);
    })();
  }

  startGame(playerId: string): void {
    this.expireGames();
    this.db.transaction(() => {
      const { game } = this.requireHost(playerId);
      if (game.status !== 'waiting') throw new GameError('ROOM_STARTED', 'The game has already started.');
      const { count } = this.db
        .prepare(`SELECT COUNT(*) AS count FROM players WHERE game_id = ? AND left_at IS NULL`)
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
      const now = this.now();
      this.db
        .prepare(`UPDATE games SET status = 'active', started_at = ?, ends_at = ? WHERE id = ?`)
        .run(now, now + game.duration_minutes * 60_000, game.id);
    })();
  }

  endGame(playerId: string): void {
    this.expireGames();
    this.db.transaction(() => {
      const { game } = this.requireHost(playerId);
      if (game.status !== 'active') throw new GameError('GAME_NOT_ACTIVE', 'The game is not running.');
      this.finishGame(game.id);
    })();
  }

  leaveGame(playerId: string | null): void {
    this.expireGames();
    if (!playerId) return;
    this.db.transaction(() => {
      const me = this.findPlayer(playerId);
      if (!me) return;
      const game = this.getGame(me.game_id);
      // Finished rounds are immutable: leaving results only clears the browser cookie.
      if (game.status === 'ended') return;
      if (game.status === 'waiting') {
        if (game.host_player_id === me.id) this.db.prepare('DELETE FROM games WHERE id = ?').run(game.id);
        else this.db.prepare('DELETE FROM players WHERE id = ?').run(me.id);
        return;
      }
      this.db.prepare(`UPDATE players SET left_at = ?, latitude = NULL, longitude = NULL,
        accuracy_m = NULL, location_at = NULL, captured_at = NULL WHERE id = ?`).run(this.now(), me.id);
      this.db.prepare('UPDATE players SET radar_snapshot = NULL, radar_at = NULL WHERE game_id = ?').run(game.id);
      if (game.host_player_id === me.id) {
        this.finishGame(game.id, 'host_left');
        return;
      }
      const remaining = this.db.prepare(`SELECT role, COUNT(*) AS count FROM players
        WHERE game_id = ? AND left_at IS NULL GROUP BY role`).all(game.id) as Array<{ role: Role; count: number }>;
      if (!remaining.some((p) => p.role === 'runner') || !remaining.some((p) => p.role === 'catcher')) {
        this.finishGame(game.id, 'players_left');
      }
    })();
  }

  updateLocation(playerId: string, input: LocationInput): LocationAck {
    this.expireGames();
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
    const capturedAt = input.captured_at === undefined || input.captured_at === null ? null : input.captured_at;
    if (capturedAt !== null && (typeof capturedAt !== 'number' || !Number.isSafeInteger(capturedAt) || capturedAt < 0)) {
      throw new GameError('INVALID_INPUT', 'Invalid capture time.');
    }

    return this.db.transaction((): LocationAck => {
      const me = this.requirePlayer(playerId);
      const game = this.getGame(me.game_id);
      if (game.status === 'ended') throw new GameError('GAME_NOT_ACTIVE', 'The game has ended.');

      const now = this.now();
      const nextUpload = Math.max(now, (me.location_at ?? (now - LOCATION_MIN_INTERVAL_MS)) + LOCATION_MIN_INTERVAL_MS);
      const rejected = (reason: LocationAck['reason']): LocationAck =>
        ({ accepted: false, reason, next_upload_at: nextUpload, server_now: now });
      if (capturedAt !== null && capturedAt > now + 5_000) return rejected('future');
      if (capturedAt !== null && now - capturedAt > FIX_MAX_AGE_MS) return rejected('expired');
      const effectiveCapture = capturedAt === null ? null : Math.min(now, capturedAt);
      if (effectiveCapture !== null && me.captured_at !== null && effectiveCapture <= me.captured_at) return rejected('older');
      if (nextUpload > now) return rejected('throttled');
      this.db
        .prepare(
          `UPDATE players SET latitude = ?, longitude = ?, accuracy_m = ?, location_at = ?, captured_at = ? WHERE id = ?`,
        )
        .run(lat, lng, accuracyM, now, effectiveCapture, me.id);
      return { accepted: true, reason: 'accepted', next_upload_at: now + LOCATION_MIN_INTERVAL_MS, server_now: now };
    })();
  }

  getMap(playerId: string): MapResponse {
    this.expireGames();
    return this.db.transaction(() => {
      const me = this.requirePlayer(playerId);
      const game = this.getGame(me.game_id);
      if (game.status !== 'active') throw new GameError('GAME_NOT_ACTIVE', 'The game is not running.');
      const players = this.db.prepare('SELECT * FROM players WHERE game_id = ? AND left_at IS NULL')
        .all(game.id) as PlayerRow[];
      return buildMapSnapshot(players, this.now(), me.id);
    })();
  }

  getRadar(playerId: string): RadarResponse {
    this.expireGames();
    return this.db.transaction((): RadarResponse => {
      const me = this.requirePlayer(playerId);
      const game = this.getGame(me.game_id);
      if (game.status !== 'active') throw new GameError('GAME_NOT_ACTIVE', 'The game is not running.');
      const now = this.now();

      if (me.radar_snapshot && me.radar_at !== null && now - me.radar_at < RADAR_INTERVAL_MS) {
        const snapshot = JSON.parse(me.radar_snapshot) as RadarSnapshot;
        // Rebuild when samples expire even inside the short cache window.
        const originAt = snapshot.origin_captured_at ?? snapshot.snapshot_at;
        if (now - originAt <= FIX_MAX_AGE_MS && snapshot.points.every((p) =>
          now - (p.captured_at ?? (snapshot.snapshot_at - p.fix_age_s * 1000)) <= FIX_MAX_AGE_MS)) {
          return { ...snapshot, next_ping_at: me.radar_at + RADAR_INTERVAL_MS, server_now: now };
        }
      }

      const others = this.db
        .prepare(`SELECT * FROM players WHERE game_id = ? AND left_at IS NULL AND id != ?`)
        .all(game.id, me.id) as PlayerRow[];

      if (me.latitude === null || me.longitude === null || me.location_at === null || !hasRecentLocation(me, now)) {
        return {
          origin_available: false,
          origin_captured_at: me.captured_at,
          origin_accuracy_m: me.accuracy_m,
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
          captured_at: me.captured_at,
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
    const now = this.now();
    this.expireGames(now);
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
        .prepare(`SELECT COUNT(*) AS runners FROM players WHERE game_id = ? AND role = 'runner' AND left_at IS NULL`)
        .get(game.id) as { runners: number };
      if (runners === 0) this.finishGame(game.id);

      return { outcome: 'tagged', target_name: target.display_name };
    })();
  }

  cleanup(): { deletedGames: number } {
    this.expireGames();
    const now = this.now();
    return this.db.transaction(() => {
      const deleted = this.db
        .prepare(`DELETE FROM games WHERE created_at < ? AND status != 'active'`)
        .run(now - GAME_RETENTION_MS);
      this.db
        .prepare(
          `UPDATE players
           SET latitude = NULL, longitude = NULL, accuracy_m = NULL, location_at = NULL, captured_at = NULL,
               radar_snapshot = NULL, radar_at = NULL
           WHERE location_at < ?`,
        )
        .run(now - STALE_LOCATION_MS);
      return { deletedGames: deleted.changes };
    })();
  }

  expireGames(now = this.now()): number {
    return this.db.transaction(() => {
      const overdue = this.db.prepare("SELECT id, ends_at FROM games WHERE status = 'active' AND ends_at <= ?")
        .all(now) as Array<{ id: string; ends_at: number }>;
      for (const game of overdue) this.finishGame(game.id, 'time_up', game.ends_at);
      return overdue.length;
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
        .prepare(`SELECT * FROM players WHERE id = ? AND game_id = ? AND left_at IS NULL`)
        .get(targetId, game.id) as PlayerRow | undefined;
      if (!target || !safeEqual(target.tag_token, token)) {
        throw new GameError('INVALID_TAG', 'That QR code is not valid.');
      }
      return target;
    }

    const code = normalizeCode(input.code);
    if (!code) throw new GameError('INVALID_INPUT', 'Tag codes are 6 characters.');
    const target = this.db
      .prepare(`SELECT * FROM players WHERE game_id = ? AND tag_code = ? AND left_at IS NULL`)
      .get(game.id, code) as PlayerRow | undefined;
    if (!target) throw new GameError('INVALID_TAG', 'No player with that tag code.');
    return target;
  }

  private finishGame(gameId: string, reason: GameRow['end_reason'] = null, endedAt = this.now()): void {
    const finished = this.db
      .prepare(`UPDATE games SET status = 'ended', ended_at = ?, end_reason = ? WHERE id = ? AND status = 'active'`)
      .run(endedAt, reason, gameId);
    if (finished.changes === 0) return;
    this.db
      .prepare(
        `UPDATE players
         SET latitude = NULL, longitude = NULL, accuracy_m = NULL, location_at = NULL, captured_at = NULL,
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

  private assertCanSwitchRoom(playerId: string | null): void {
    if (!playerId) return;
    const existing = this.findPlayer(playerId);
    if (!existing) return;
    const current = this.getGame(existing.game_id);
    if (current.status !== 'ended') {
      throw new GameError(
        'ALREADY_IN_GAME',
        'Exit your current room or finish the game before starting or joining another.',
      );
    }
  }

  private findPlayer(playerId: string): PlayerRow | undefined {
    return this.db.prepare(`SELECT * FROM players WHERE id = ? AND left_at IS NULL`).get(playerId) as PlayerRow | undefined;
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

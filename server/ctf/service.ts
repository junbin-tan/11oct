import { timingSafeEqual } from 'node:crypto';
import type { Db } from '../db.js';
import { newId, normalizeCode, randomCode, randomToken } from '../game/codes.js';
import { CTF, distance, displayName, position, requireCondition as check } from './rules.js';
import { initializeCtf } from './storage.js';
import type { Checkpoint, CtfState, Outcome, Position } from './types.js';

interface Game {
  id: string; code: string; host_id: string; status: CtfState['game']['status']; created_at: number;
  start_lat: number | null; start_lng: number | null; setup_version: number; confirmed: number;
  ends_at: number | null; outcome: Outcome | null;
}
interface Player {
  id: string; game_id: string; name: string; role: 'runner' | 'catcher'; tag_code: string; token: string;
  left_at: number | null; lat: number | null; lng: number | null; accuracy: number | null;
  captured_at: number | null; received_at: number | null;
}
type Attempt = NonNullable<CtfState['attempt']>;

export class CtfService {
  constructor(private db: Db, private now: () => number = Date.now) { initializeCtf(db); }

  private player(id: string): Player {
    const p = this.db.prepare('SELECT * FROM ctf_players WHERE id = ? AND left_at IS NULL').get(id) as Player | undefined;
    check(p, 'NOT_IN_ROOM', 'Join a Capture the Flag room first.', 401);
    return p;
  }
  private game(id: string): Game { return this.db.prepare('SELECT * FROM ctf_games WHERE id = ?').get(id) as Game; }
  private players(id: string): Player[] { return this.db.prepare('SELECT * FROM ctf_players WHERE game_id = ? ORDER BY rowid').all(id) as Player[]; }
  private flags(id: string): Checkpoint[] { return this.db.prepare('SELECT id, name, lat, lng, captured_at, captured_by FROM ctf_checkpoints WHERE game_id = ? ORDER BY rowid').all(id) as Checkpoint[]; }
  private origin(g: Game): Position | null { return g.start_lat === null ? null : { lat: g.start_lat, lng: g.start_lng! }; }
  private fresh(p: Player): boolean {
    return p.lat !== null && p.lng !== null && p.accuracy !== null && p.accuracy <= CTF.accuracy
      && p.captured_at !== null && p.captured_at <= this.now() && this.now() - p.captured_at <= CTF.freshMs;
  }
  private eligible(p: Player, g: Game): boolean {
    const start = this.origin(g);
    return p.left_at === null && this.fresh(p) && !!start && distance({ lat: p.lat!, lng: p.lng! }, start) <= CTF.boundary;
  }
  private host(id: string): { p: Player; g: Game } {
    const p = this.player(id), g = this.game(p.game_id);
    check(g.host_id === id, 'HOST_ONLY', 'Only the host can do this.', 403);
    return { p, g };
  }
  private waiting(g: Game) { check(g.status === 'waiting', 'ROOM_STARTED', 'Setup is locked after starting.', 409); }
  private active(g: Game) { check(g.status === 'active', 'GAME_NOT_ACTIVE', 'This round is not active.', 409); }
  private canSwitch(id: string | null) {
    if (!id) return;
    const p = this.db.prepare('SELECT * FROM ctf_players WHERE id = ? AND left_at IS NULL').get(id) as Player | undefined;
    check(!p || this.game(p.game_id).status === 'ended', 'ALREADY_IN_GAME', 'Leave your current Capture the Flag room first.', 409);
  }
  private uniqueCode(table: 'ctf_games' | 'ctf_players', gameId?: string): string {
    for (let n = 0; n < 20; n++) {
      const code = randomCode();
      const existing = table === 'ctf_games' ? this.db.prepare('SELECT 1 FROM ctf_games WHERE code = ?').get(code)
        : this.db.prepare('SELECT 1 FROM ctf_players WHERE game_id = ? AND tag_code = ?').get(gameId, code);
      if (!existing) return code;
    }
    throw new Error('Could not allocate a CTF code');
  }
  private insertPlayer(gameId: string, name: string, role: Player['role'], id = newId()): string {
    this.db.prepare('INSERT INTO ctf_players(id, game_id, name, role, tag_code, token) VALUES(?,?,?,?,?,?)')
      .run(id, gameId, name, role, this.uniqueCode('ctf_players', gameId), randomToken());
    return id;
  }

  create(nameInput: unknown, current: string | null): string {
    this.tick();
    const name = displayName(nameInput);
    return this.db.transaction(() => {
      this.canSwitch(current);
      const gameId = newId(), id = newId();
      this.db.prepare('INSERT INTO ctf_games(id, code, host_id, created_at) VALUES(?,?,?,?)')
        .run(gameId, this.uniqueCode('ctf_games'), id, this.now());
      return this.insertPlayer(gameId, name, 'catcher', id);
    })();
  }
  join(nameInput: unknown, codeInput: unknown, current: string | null): string {
    this.tick();
    const name = displayName(nameInput), code = normalizeCode(codeInput);
    check(code, 'INVALID_INPUT', 'Enter the six-character room code.');
    return this.db.transaction(() => {
      const g = this.db.prepare('SELECT * FROM ctf_games WHERE code = ?').get(code) as Game | undefined;
      check(g, 'ROOM_NOT_FOUND', 'No Capture the Flag room has that code.', 404);
      if (current && this.players(g.id).some(p => p.id === current && p.left_at === null)) return current;
      this.canSwitch(current); this.waiting(g);
      check(this.players(g.id).filter(p => p.left_at === null).length < 30, 'ROOM_FULL', 'This room is full.', 409);
      return this.insertPlayer(g.id, name, 'runner');
    })();
  }
  state(id: string | null): CtfState | null {
    this.tick();
    if (!id || !this.db.prepare('SELECT 1 FROM ctf_players WHERE id = ? AND left_at IS NULL').get(id)) return null;
    const p = this.player(id), g = this.game(p.game_id);
    return {
      server_now: this.now(),
      game: { code: g.code, status: g.status, start: this.origin(g), setup_version: g.setup_version,
        confirmed: !!g.confirmed, ends_at: g.ends_at, outcome: g.outcome,
        winner: g.outcome === 'flags_captured' ? 'runners' : g.outcome === 'all_caught' || g.outcome === 'time_up' ? 'catchers' : null },
      me: { id, name: p.name, role: p.role, is_host: g.host_id === id, tag_code: p.tag_code, qr_payload: `ctf:${g.code}:${id}:${p.token}` },
      players: this.players(g.id).filter(x => g.status === 'ended' || x.left_at === null).map(x => ({
        id: x.id, name: x.name, role: x.role, left: x.left_at !== null, gps_ready: this.fresh(x), eligible: this.eligible(x, g),
        location: this.fresh(x) ? { lat: x.lat!, lng: x.lng!, accuracy: x.accuracy!, captured_at: x.captured_at! } : null,
      })),
      checkpoints: this.flags(g.id),
      attempt: (this.db.prepare('SELECT checkpoint_id, elapsed_ms, last_received_at, last_captured_at FROM ctf_attempts WHERE player_id = ?').get(id) as Attempt | undefined) ?? null,
    };
  }
  setupStart(id: string) {
    this.tick();
    this.db.transaction(() => {
      const { p, g } = this.host(id); this.waiting(g);
      check(this.fresh(p), 'GPS_REQUIRED', 'Wait for a fresh GPS reading accurate to 15 m.');
      this.db.prepare('DELETE FROM ctf_checkpoints WHERE game_id = ?').run(g.id);
      this.db.prepare('UPDATE ctf_games SET start_lat = ?, start_lng = ?, setup_version = setup_version + 1, confirmed = 0 WHERE id = ?')
        .run(p.lat, p.lng, g.id);
    })();
  }
  landmarkOrigin(id: string) {
    const { g } = this.host(id); this.waiting(g);
    const start = this.origin(g); check(start, 'SET_START', 'Set the starting point first.');
    return { start, setup_version: g.setup_version };
  }
  saveCheckpoints(id: string, version: unknown, input: unknown) {
    this.tick();
    this.db.transaction(() => {
      const { g } = this.host(id); this.waiting(g);
      const start = this.origin(g); check(start, 'SET_START', 'Set the starting point first.');
      check(version === g.setup_version, 'SETUP_CHANGED', 'The starting point changed. Review the new map.', 409);
      check(Array.isArray(input) && input.length === CTF.flagCount, 'INVALID_INPUT', 'Place exactly three checkpoints.');
      const flags = input.map((item: unknown) => {
        const pos = position(item);
        check(distance(start, pos) <= CTF.checkpointLimit, 'INVALID_INPUT', 'Keep checkpoint centres within 85 m of the start.');
        return { ...pos, name: displayName((item as { name?: unknown }).name, 80) };
      });
      flags.forEach((a, i) => flags.slice(i + 1).forEach(b => check(distance(a, b) > CTF.spacing, 'INVALID_INPUT', 'Keep checkpoints more than 30 m apart.')));
      this.db.prepare('DELETE FROM ctf_checkpoints WHERE game_id = ?').run(g.id);
      for (const f of flags) this.db.prepare('INSERT INTO ctf_checkpoints(id, game_id, name, lat, lng) VALUES(?,?,?,?,?)').run(newId(), g.id, f.name, f.lat, f.lng);
      this.db.prepare('UPDATE ctf_games SET confirmed = 1 WHERE id = ?').run(g.id);
    })();
  }
  start(id: string) {
    this.tick();
    this.db.transaction(() => {
      const { p, g } = this.host(id); this.waiting(g);
      const players = this.players(g.id).filter(x => x.left_at === null);
      check(players.length >= 2, 'NOT_ENOUGH_PLAYERS', 'Invite at least one runner.');
      check(g.confirmed && this.flags(g.id).length === 3, 'SETUP_REQUIRED', 'Confirm three checkpoints first.');
      check(players.every(x => this.eligible(x, g)), 'GPS_REQUIRED', 'Everyone needs fresh GPS and must be inside the 100 m boundary.');
      check(distance({ lat: p.lat!, lng: p.lng! }, this.origin(g)!) <= 15, 'RETURN_TO_START', 'Return within 15 m of the confirmed start.');
      this.db.prepare("UPDATE ctf_games SET status = 'active', ends_at = ? WHERE id = ?").run(this.now() + CTF.durationMs, g.id);
    })();
  }
  location(id: string, input: { lat?: unknown; lng?: unknown; accuracy?: unknown; captured_at?: unknown }) {
    this.tick();
    const pos = position(input), at = input.captured_at, accuracy = input.accuracy;
    check(typeof at === 'number' && Number.isSafeInteger(at) && at >= 0, 'INVALID_INPUT', 'A GPS measurement timestamp is required.');
    check(accuracy === null || (typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0), 'INVALID_INPUT', 'Invalid GPS accuracy.');
    return this.db.transaction(() => {
      const p = this.player(id), g = this.game(p.game_id), now = this.now();
      check(g.status !== 'ended', 'GAME_NOT_ACTIVE', 'This round has ended.', 409);
      const ack = (accepted: boolean, reason: string) => ({ accepted, reason, server_now: now });
      // Retries and out-of-order packets are inert, including for capture progress.
      if (p.captured_at !== null && at <= p.captured_at) return ack(false, 'older');
      if (at > now || now - at > CTF.freshMs) {
        this.reset(p.id); return ack(false, at > now ? 'future' : 'expired');
      }
      if (p.received_at !== null && now - p.received_at < CTF.uploadMs) return ack(false, 'throttled');
      this.db.prepare('UPDATE ctf_players SET lat = ?, lng = ?, accuracy = ?, captured_at = ?, received_at = ? WHERE id = ?')
        .run(pos.lat, pos.lng, accuracy, at, now, id);
      if (g.status === 'active') this.advance(this.player(id), g);
      return ack(true, 'accepted');
    })();
  }
  private reset(id: string) { this.db.prepare('DELETE FROM ctf_attempts WHERE player_id = ?').run(id); }
  private advance(p: Player, g: Game) {
    const flag = p.role === 'runner' && this.eligible(p, g)
      ? this.flags(g.id).find(f => f.captured_at === null && distance({ lat: p.lat!, lng: p.lng! }, f) <= CTF.captureRadius) : undefined;
    if (!flag) { this.reset(p.id); return; }
    const old = this.db.prepare('SELECT * FROM ctf_attempts WHERE player_id = ?').get(p.id) as Attempt | undefined;
    const now = this.now();
    const continuous = old && old.checkpoint_id === flag.id && now - old.last_received_at <= CTF.freshMs
      && p.captured_at! - old.last_captured_at <= CTF.freshMs;
    // Require both server elapsed time and measurement elapsed time; delayed fixes cannot manufacture a minute.
    const elapsed = continuous ? old.elapsed_ms + Math.min(now - old.last_received_at, p.captured_at! - old.last_captured_at) : 0;
    if (elapsed >= CTF.captureMs) {
      this.db.prepare('UPDATE ctf_checkpoints SET captured_at = ?, captured_by = ? WHERE id = ? AND captured_at IS NULL').run(now, p.id, flag.id);
      this.db.prepare('DELETE FROM ctf_attempts WHERE checkpoint_id = ?').run(flag.id);
      if (this.flags(g.id).every(f => f.captured_at !== null)) this.finish(g.id, 'flags_captured');
    } else {
      this.db.prepare(`INSERT INTO ctf_attempts(player_id, checkpoint_id, elapsed_ms, last_received_at, last_captured_at) VALUES(?,?,?,?,?)
        ON CONFLICT(player_id) DO UPDATE SET checkpoint_id=excluded.checkpoint_id, elapsed_ms=excluded.elapsed_ms,
        last_received_at=excluded.last_received_at, last_captured_at=excluded.last_captured_at`).run(p.id, flag.id, elapsed, now, p.captured_at);
    }
  }
  tag(id: string, input: { code?: unknown; payload?: unknown }) {
    this.tick();
    return this.db.transaction(() => {
      const p = this.player(id), g = this.game(p.game_id); this.active(g);
      check(p.role === 'catcher', 'NOT_CATCHER', 'Only catchers can tag.', 403);
      check(this.eligible(p, g), 'OUTSIDE_OR_GPS', 'Return inside the boundary with fresh GPS before tagging.');
      let target: Player | undefined;
      if (typeof input.payload === 'string') {
        const parts = input.payload.split(':');
        check(parts.length === 4 && parts[0] === 'ctf' && parts[1] === g.code, 'INVALID_TAG', 'This QR belongs to another game.');
        target = this.players(g.id).find(x => x.id === parts[2] && x.left_at === null);
        const supplied = Buffer.from(parts[3]!), expected = Buffer.from(target?.token ?? '');
        check(target && supplied.length === expected.length && timingSafeEqual(supplied, expected), 'INVALID_TAG', 'Invalid tag QR.');
      } else {
        const code = normalizeCode(input.code);
        target = this.players(g.id).find(x => code && x.tag_code === code && x.left_at === null);
      }
      check(target && target.id !== id, 'INVALID_TAG', 'No other player has that tag code.');
      if (target.role === 'catcher') return { outcome: 'already_tagged' as const, name: target.name };
      this.db.prepare("UPDATE ctf_players SET role = 'catcher' WHERE id = ?").run(target.id);
      this.db.prepare('INSERT INTO ctf_tags(target_id, catcher_id, created_at) VALUES(?,?,?)').run(target.id, id, this.now());
      this.reset(target.id);
      if (!this.players(g.id).some(x => x.left_at === null && x.role === 'runner')) this.finish(g.id, 'all_caught');
      return { outcome: 'tagged' as const, name: target.name };
    })();
  }
  end(id: string) {
    this.tick();
    this.db.transaction(() => { const { g } = this.host(id); this.active(g); this.finish(g.id, 'interrupted'); })();
  }
  leave(id: string | null) {
    this.tick();
    if (!id || !this.state(id)) return;
    this.db.transaction(() => {
      const p = this.player(id), g = this.game(p.game_id);
      if (g.status === 'ended') return;
      if (g.status === 'waiting' && g.host_id === id) { this.db.prepare('DELETE FROM ctf_games WHERE id = ?').run(g.id); return; }
      this.db.prepare('UPDATE ctf_players SET left_at = ?, lat = NULL, lng = NULL, accuracy = NULL, captured_at = NULL, received_at = NULL WHERE id = ?').run(this.now(), id);
      this.reset(id);
      const remaining = this.players(g.id).filter(x => x.left_at === null);
      if (g.status === 'active' && (g.host_id === id || !remaining.some(x => x.role === 'runner') || !remaining.some(x => x.role === 'catcher'))) this.finish(g.id, 'interrupted');
    })();
  }
  private finish(id: string, outcome: Outcome) {
    this.db.prepare("UPDATE ctf_games SET status = 'ended', outcome = ?, ended_at = ? WHERE id = ? AND status = 'active'").run(outcome, this.now(), id);
    this.db.prepare('DELETE FROM ctf_attempts WHERE player_id IN (SELECT id FROM ctf_players WHERE game_id = ?)').run(id);
    this.db.prepare('UPDATE ctf_players SET lat = NULL, lng = NULL, accuracy = NULL, captured_at = NULL, received_at = NULL WHERE game_id = ?').run(id);
  }
  tick() {
    this.db.transaction(() => {
      const now = this.now();
      for (const g of this.db.prepare("SELECT id FROM ctf_games WHERE status = 'active' AND ends_at <= ?").all(now) as Array<{ id: string }>) this.finish(g.id, 'time_up');
      this.db.prepare('DELETE FROM ctf_attempts WHERE last_received_at < ? OR last_captured_at < ?').run(now - CTF.freshMs, now - CTF.freshMs);
    })();
  }
  cleanup() {
    this.tick();
    this.db.prepare("DELETE FROM ctf_games WHERE (status = 'waiting' AND created_at < ?) OR (status = 'ended' AND ended_at < ?)")
      .run(this.now() - CTF.retentionMs, this.now() - CTF.retentionMs);
    this.db.prepare('UPDATE ctf_players SET lat = NULL, lng = NULL, accuracy = NULL, captured_at = NULL, received_at = NULL WHERE received_at < ?')
      .run(this.now() - CTF.retentionMs);
  }
}

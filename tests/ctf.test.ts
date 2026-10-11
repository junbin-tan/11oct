import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../server/db.js';
import { CtfService } from '../server/ctf/service.js';
import { CTF, distance } from '../server/ctf/rules.js';
import type { Position } from '../server/ctf/types.js';

let db: Db, service: CtfService, clock: number;
const origin = { lat: 1.3, lng: 103.8 };
function point(north = 0, east = 0): Position {
  return { lat: origin.lat + north / 6_371_000 * 180 / Math.PI,
    lng: origin.lng + east / (6_371_000 * Math.cos(origin.lat * Math.PI / 180)) * 180 / Math.PI };
}
const flags = [point(45), point(-35, 35), point(-35, -35)].map((p, i) => ({ ...p, name: `Flag ${i + 1}` }));
function location(id: string, p = origin, accuracy: number | null = 5, captured_at = clock) {
  return service.location(id, { ...p, accuracy, captured_at });
}
function room(runners = 1) {
  const host = service.create('Host', null), code = service.state(host)!.game.code;
  const others = Array.from({ length: runners }, (_, i) => service.join(`Runner ${i}`, code, null));
  for (const id of [host, ...others]) location(id);
  service.setupStart(host);
  service.saveCheckpoints(host, service.state(host)!.game.setup_version, flags);
  return { host, runners: others, runner: others[0]! };
}
function hold(id: string, p: Position, milliseconds = 60_000) {
  clock += 5_000; location(id, p);
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 5_000) { clock += 5_000; location(id, p); }
}
beforeEach(() => { clock = 1_800_000_000_000; db = openDb(':memory:'); service = new CtfService(db, () => clock); });
afterEach(() => db.close());

describe('CTF setup and isolation', () => {
  it('adds only independent tables and can initialize repeatedly without changing original data or schema', () => {
    db.prepare("INSERT INTO games(id, code, host_player_id, created_at, duration_minutes) VALUES('old','OLD123','p',1,90)").run();
    const before = db.prepare("SELECT name, sql FROM sqlite_master WHERE name IN ('games','players','tag_events') ORDER BY name").all();
    room(); new CtfService(db, () => clock);
    expect(db.prepare('SELECT * FROM games').all()).toEqual([expect.objectContaining({ id: 'old', duration_minutes: 90 })]);
    expect(db.prepare("SELECT name, sql FROM sqlite_master WHERE name IN ('games','players','tag_events') ORDER BY name").all()).toEqual(before);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
  it('requires host, fresh GPS, a start and three well-separated flags', () => {
    const host = service.create('Host', null), runner = service.join('Runner', service.state(host)!.game.code, null);
    expect(() => service.setupStart(host)).toThrow('fresh GPS');
    expect(() => service.setupStart(runner)).toThrow('Only the host');
    location(host); service.setupStart(host);
    const version = service.state(host)!.game.setup_version;
    expect(() => service.saveCheckpoints(host, version, flags.slice(0, 2))).toThrow('exactly three');
    expect(() => service.saveCheckpoints(host, version, [flags[0], flags[0], flags[1]])).toThrow('30 m apart');
    expect(() => service.saveCheckpoints(host, version, [{ ...point(86), name: 'Far' }, flags[1], flags[2]])).toThrow('85 m');
    service.saveCheckpoints(host, version, flags);
    expect(() => service.start(host)).toThrow('Everyone needs fresh GPS');
    location(runner); service.start(host);
    expect(service.state(host)!.game.ends_at).toBe(clock + 30 * 60_000);
    expect(() => service.saveCheckpoints(host, version, flags)).toThrow('locked');
    expect(() => service.setupStart(host)).toThrow('locked');
    expect(() => service.join('Late', service.state(host)!.game.code, null)).toThrow('locked');
  });
  it('resetting the starting point invalidates old confirmations and in-flight landmark results', () => {
    const { host } = room(); const version = service.state(host)!.game.setup_version;
    service.setupStart(host);
    expect(service.state(host)!.checkpoints).toEqual([]);
    expect(service.state(host)!.game.confirmed).toBe(false);
    expect(() => service.saveCheckpoints(host, version, flags)).toThrow('starting point changed');
  });
  it('requires the host near the fixed start and everyone inside the boundary', () => {
    const { host, runner } = room(); clock += 5_000;
    location(host, point(16)); location(runner);
    expect(() => service.start(host)).toThrow('within 15 m');
    clock += 5_000; location(host); location(runner, point(100.1));
    expect(() => service.start(host)).toThrow('inside the 100 m');
    clock += 5_000; location(runner, point(99.9)); location(host);
    service.start(host);
    expect(service.state(host)!.game.start).toEqual(origin);
  });
  it('validates inputs and prevents switching live CTF sessions', () => {
    const { host, runner } = room();
    expect(() => service.create('Again', host)).toThrow('Leave your current');
    expect(() => location(runner, { lat: NaN, lng: 0 })).toThrow('coordinates');
    expect(() => location(runner, origin, -1)).toThrow('accuracy');
    expect(() => service.location(runner, { ...origin, accuracy: 5, captured_at: null })).toThrow('timestamp');
  });
});

describe('CTF capture evidence', () => {
  it('requires 60 seconds and a new qualifying upload; leaves captured flags permanent', () => {
    const { host, runner } = room(); service.start(host);
    hold(runner, flags[0]!, 55_000);
    expect(service.state(runner)!.attempt!.elapsed_ms).toBe(55_000);
    clock += 5_000;
    expect(service.state(runner)!.checkpoints[0]!.captured_at).toBeNull();
    location(runner, flags[0]!);
    expect(service.state(runner)!.checkpoints[0]!.captured_at).toBe(clock);
    expect(service.state(runner)!.attempt).toBeNull();
    hold(runner, flags[0]!, 5_000);
    expect(service.state(runner)!.attempt).toBeNull();
  });
  it('resets on exiting a 15 m capture circle and on switching flags', () => {
    const { host, runner } = room(); service.start(host); hold(runner, flags[0]!, 20_000);
    clock += 5_000; location(runner, point(60.01));
    expect(service.state(runner)!.attempt).toBeNull();
    clock += 5_000; location(runner, point(59.99));
    expect(service.state(runner)!.attempt!.elapsed_ms).toBe(0);
    clock += 5_000; location(runner, flags[1]!);
    expect(service.state(runner)!.attempt).toMatchObject({ checkpoint_id: service.state(runner)!.checkpoints[1]!.id, elapsed_ms: 0 });
  });
  it('resets a runner attempt when they leave the overall boundary', () => {
    const { host, runner } = room(); service.start(host); hold(runner, flags[0]!, 20_000);
    clock += 5_000; location(runner, point(101));
    expect(service.state(runner)!.attempt).toBeNull();
    expect(service.state(runner)!.players.find(p => p.id === runner)!.eligible).toBe(false);
    clock += 5_000; location(runner, flags[0]!);
    expect(service.state(runner)!.attempt!.elapsed_ms).toBe(0);
  });
  it.each([null, 15.01, 100])('resets when accuracy is %s', accuracy => {
    const { host, runner } = room(); service.start(host); hold(runner, flags[0]!, 20_000);
    clock += 5_000; location(runner, flags[0]!, accuracy);
    expect(service.state(runner)!.attempt).toBeNull();
  });
  it('accepts 15 m accuracy and resets after a GPS or receipt gap over 10 seconds', () => {
    const { host, runner } = room(); service.start(host);
    clock += 5_000; location(runner, flags[0]!, 15);
    clock += 10_000; location(runner, flags[0]!, 15);
    expect(service.state(runner)!.attempt!.elapsed_ms).toBe(10_000);
    clock += 10_001; location(runner, flags[0]!, 15);
    expect(service.state(runner)!.attempt!.elapsed_ms).toBe(0);
  });
  it('rejects expired/future fixes and cannot progress through duplicate, throttled or reordered uploads', () => {
    const { host, runner } = room(); service.start(host); hold(runner, flags[0]!, 20_000);
    const at = clock;
    expect(location(runner, flags[0]!)).toMatchObject({ accepted: false, reason: 'older' });
    expect(location(runner, flags[0]!, 5, at - 1)).toMatchObject({ reason: 'older' });
    clock += 1_000;
    expect(location(runner, flags[0]!)).toMatchObject({ reason: 'throttled' });
    expect(service.state(runner)!.attempt!.elapsed_ms).toBe(20_000);
    expect(location(runner, flags[0]!, 5, clock + 1)).toMatchObject({ reason: 'future' });
    expect(service.state(runner)!.attempt).toBeNull();
    clock += 20_000;
    expect(location(runner, flags[0]!, 5, clock - 10_001)).toMatchObject({ reason: 'expired' });
  });
  it('shares completed flags without relaying attempts or accelerating with more runners', () => {
    const { host, runners } = room(2), [a, b] = runners as [string, string]; service.start(host);
    hold(a, flags[0]!, 20_000);
    location(b, flags[0]!);
    expect(service.state(b)!.attempt!.elapsed_ms).toBe(0);
    clock += 5_000; location(a, origin); location(b, flags[0]!);
    expect(service.state(b)!.attempt!.elapsed_ms).toBe(5_000);
    for (let i = 0; i < 11; i++) { clock += 5_000; location(b, flags[0]!); }
    expect(service.state(a)!.checkpoints[0]!.captured_by).toBe(b);
  });
  it('awards a simultaneous checkpoint only once and supports captures at different flags', () => {
    const { host, runners } = room(3); service.start(host);
    for (let i = 0; i <= 12; i++) {
      clock += 5_000;
      runners.forEach((id, index) => location(id, flags[index === 2 ? 1 : 0]!));
    }
    const state = service.state(host)!;
    expect(state.checkpoints.filter(f => f.captured_at !== null)).toHaveLength(2);
    expect(state.checkpoints[0]!.captured_by).toBe(runners[0]);
    expect(service.state(runners[1]!)!.attempt).toBeNull();
  });
  it('persists captures across service restart without crediting disconnected time', () => {
    const { host, runner } = room(); service.start(host); hold(runner, flags[0]!); hold(runner, flags[1]!, 20_000);
    clock += 30_000; service = new CtfService(db, () => clock);
    expect(service.state(runner)!.checkpoints[0]!.captured_at).not.toBeNull();
    expect(service.state(runner)!.attempt).toBeNull();
    location(runner, flags[1]!);
    expect(service.state(runner)!.attempt!.elapsed_ms).toBe(0);
  });
});

describe('CTF tagging, terminal outcomes and cleanup', () => {
  it('converts a runner and resets the attempt, without proximity-only interruption', () => {
    const { host, runner } = room(); service.start(host); hold(runner, flags[0]!, 55_000);
    location(host, flags[0]!);
    expect(service.state(runner)!.attempt!.elapsed_ms).toBe(55_000);
    service.tag(host, { payload: service.state(runner)!.me.qr_payload });
    expect(service.state(runner)!.me.role).toBe('catcher');
    expect(service.state(runner)!.attempt).toBeNull();
    expect(service.state(host)!.game).toMatchObject({ winner: 'catchers', outcome: 'all_caught' });
    expect(() => location(runner, flags[0]!)).toThrow('ended');
  });
  it('blocks out-of-bounds catchers but permits tagging an out-of-bounds runner', () => {
    const { host, runner } = room(); service.start(host);
    clock += 5_000; location(host, point(100.1)); location(runner, point(110));
    const code = service.state(runner)!.me.tag_code;
    expect(() => service.tag(host, { code })).toThrow('Return inside');
    clock += 5_000; location(host, point(99.9));
    service.tag(host, { code });
    expect(service.state(host)!.game.outcome).toBe('all_caught');
  });
  it('rejects foreign QR credentials and repeat catches cannot score twice', () => {
    const { host, runners } = room(2); service.start(host);
    const other = service.create('Other', null);
    expect(() => service.tag(host, { payload: service.state(other)!.me.qr_payload })).toThrow('another game');
    const code = service.state(runners[0]!)!.me.tag_code;
    expect(service.tag(host, { code }).outcome).toBe('tagged');
    expect(service.tag(host, { code }).outcome).toBe('already_tagged');
    expect(db.prepare('SELECT COUNT(*) AS n FROM ctf_tags').get()).toEqual({ n: 1 });
  });
  it('awards runners all flags in any order and locks the first terminal result', () => {
    const { host, runner } = room(); service.start(host);
    for (const flag of [flags[2]!, flags[0]!, flags[1]!]) hold(runner, flag);
    expect(service.state(host)!.game).toMatchObject({ status: 'ended', winner: 'runners', outcome: 'flags_captured' });
    expect(() => service.tag(host, { code: service.state(runner)!.me.tag_code })).toThrow('not active');
    clock += CTF.durationMs; service.tick();
    expect(service.state(host)!.game.outcome).toBe('flags_captured');
  });
  it('timeout wins over a capture uploaded exactly at the deadline', () => {
    const { host, runner } = room(); service.start(host);
    hold(runner, flags[0]!); hold(runner, flags[1]!);
    clock = service.state(host)!.game.ends_at! - 65_000;
    hold(runner, flags[2]!, 55_000);
    clock += 5_000;
    expect(() => location(runner, flags[2]!)).toThrow('ended');
    expect(service.state(host)!.game).toMatchObject({ winner: 'catchers', outcome: 'time_up' });
    expect(service.state(host)!.checkpoints[2]!.captured_at).toBeNull();
  });
  it.each(['host', 'runner', 'end'] as const)('marks %s departure/end as interrupted with no winner', action => {
    const { host, runner } = room(); service.start(host);
    if (action === 'end') service.end(host); else service.leave(action === 'host' ? host : runner);
    expect(service.state(action === 'host' ? runner : host)!.game).toMatchObject({ status: 'ended', outcome: 'interrupted', winner: null });
  });
  it('cleans up its own rooms and coordinates without changing original rows', () => {
    db.prepare("INSERT INTO games(id, code, created_at) VALUES('original','ABC123',0)").run();
    const { host, runner } = room(); service.start(host); hold(runner, flags[0]!); service.end(host);
    expect(service.state(host)!.players.every(p => p.location === null)).toBe(true);
    clock += CTF.retentionMs + 1; service.cleanup();
    expect(service.state(runner)).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM ctf_games').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM ctf_checkpoints').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM games').get()).toEqual({ n: 1 });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
  it('measures metre boundaries without changing global radar constants', () => {
    expect(distance(origin, point(100))).toBeCloseTo(100, 6);
    expect(CTF.boundary).toBe(100);
  });
});

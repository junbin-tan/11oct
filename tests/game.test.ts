import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../server/app.js';
import { openDb, type Db } from '../server/db.js';
import { GAME_RETENTION_MS } from '../server/game/service.js';

const config = { cookieSecret: 'test-secret-test-secret-test-secret-0000', cookieSecure: false, clientDir: null };

let db: Db;
let app: FastifyInstance;
let clock: number;

beforeEach(async () => {
  clock = Date.UTC(2026, 9, 11, 10, 0, 0);
  db = openDb(':memory:');
  ({ app } = await buildApp({ db, config, now: () => clock, rateLimit: false }));
});

afterEach(async () => {
  await app.close();
  db.close();
});

class Client {
  cookie = '';

  async call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) {
    const res = await app.inject({
      method,
      url,
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
      },
      payload: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    const setCookie = res.headers['set-cookie'];
    if (setCookie) this.cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]!;
    return { status: res.statusCode, body: res.json(), raw: res.body };
  }

  state() {
    return this.call('GET', '/api/game').then((r) => r.body.state);
  }

  location(lat: number, lng: number, accuracy: number | null = 10, captured_at: number | null = clock) {
    return this.call('PUT', '/api/game/location', { lat, lng, accuracy, captured_at });
  }
}

async function createRoom(names: string[], start = false) {
  const host = new Client();
  const created = await host.call('POST', '/api/games', { name: names[0] });
  const code: string = created.body.state.game.code;
  const others: Client[] = [];
  for (const name of names.slice(1)) {
    const client = new Client();
    const joined = await client.call('POST', '/api/games/join', { code, name });
    expect(joined.status).toBe(200);
    others.push(client);
  }
  if (start) expect((await host.call('POST', '/api/game/start')).status).toBe(200);
  return { host, others, code };
}

describe('create, join and start', () => {
  it('creates a room with the host as first catcher and lets others join as runners', async () => {
    const { host, others, code } = await createRoom(['Alice', 'Bob']);
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    const hostState = await host.state();
    expect(hostState.me).toMatchObject({ name: 'Alice', role: 'catcher', is_host: true });
    const bobState = await others[0]!.state();
    expect(bobState.me).toMatchObject({ name: 'Bob', role: 'runner', is_host: false });
    expect(bobState.players.map((p: { name: string }) => p.name)).toEqual(['Alice', 'Bob']);
  });

  it('resumes the same membership when rejoining with the same cookie', async () => {
    const { others, code } = await createRoom(['Alice', 'Bob']);
    const before = await others[0]!.state();
    await others[0]!.call('POST', '/api/games/join', { code, name: 'Bob' });
    const after = await others[0]!.state();
    expect(after.me.player_id).toBe(before.me.player_id);
    expect(after.players).toHaveLength(2);
  });

  it('validates names and room codes', async () => {
    const client = new Client();
    expect((await client.call('POST', '/api/games', { name: '   ' })).body.error).toBe('INVALID_INPUT');
    expect((await client.call('POST', '/api/games', { name: 'x'.repeat(25) })).body.error).toBe('INVALID_INPUT');
    expect((await client.call('POST', '/api/games/join', { code: 'ZZZZZZ', name: 'Al' })).body.error).toBe(
      'ROOM_NOT_FOUND',
    );
  });

  it('rejects non-JSON mutations', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/games', payload: 'name=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(res.statusCode).toBe(415);
  });

  it('only lets the host start, and needs two players', async () => {
    const solo = new Client();
    await solo.call('POST', '/api/games', { name: 'Solo' });
    expect((await solo.call('POST', '/api/game/start')).body.error).toBe('NOT_ENOUGH_PLAYERS');

    const { host, others } = await createRoom(['Alice', 'Bob']);
    expect((await others[0]!.call('POST', '/api/game/start')).body.error).toBe('HOST_ONLY');
    expect((await others[0]!.call('POST', '/api/game/end')).body.error).toBe('HOST_ONLY');
    const started = await host.call('POST', '/api/game/start');
    expect(started.body.state.game.status).toBe('active');
    expect(started.body.state.game.started_at).toBe(clock);
  });

  it('keeps a live membership until that game ends or expires', async () => {
    const first = await createRoom(['Alice', 'Bob']);
    const other = await createRoom(['Cara']);
    const blockedCreate = await first.host.call('POST', '/api/games', { name: 'Alice' });
    const blockedJoin = await first.host.call('POST', '/api/games/join', { code: other.code, name: 'Alice' });
    expect(blockedCreate.body.error).toBe('ALREADY_IN_GAME');
    expect(blockedJoin.body.error).toBe('ALREADY_IN_GAME');
    expect((await first.host.state()).game.code).toBe(first.code);
    expect((await other.host.state()).players).toHaveLength(1);

    expect((await first.host.call('POST', '/api/game/start')).status).toBe(200);
    expect((await first.host.call('POST', '/api/game/end')).status).toBe(200);
    const replaced = await first.host.call('POST', '/api/games/join', { code: other.code, name: 'Alice' });
    expect(replaced.status).toBe(200);
    expect(replaced.body.state.game.code).toBe(other.code);
    expect(replaced.body.state.players.map((p: { name: string }) => p.name).sort()).toEqual(['Alice', 'Cara']);

    const expired = new Client();
    await expired.call('POST', '/api/games', { name: 'Expired' });
    db.prepare('DELETE FROM games WHERE code != ?').run(other.code);
    const renewed = await expired.call('POST', '/api/games', { name: 'Expired' });
    expect(renewed.status).toBe(200);
    expect(renewed.body.state.me.name).toBe('Expired');
  });

  it('rejects joining after the game has started or ended', async () => {
    const { host, code } = await createRoom(['Alice', 'Bob'], true);
    const late = new Client();
    expect((await late.call('POST', '/api/games/join', { code, name: 'Late' })).body.error).toBe('ROOM_STARTED');
    await host.call('POST', '/api/game/end');
    expect((await late.call('POST', '/api/games/join', { code, name: 'Late' })).body.error).toBe('ROOM_ENDED');
  });

  it('rejects requests without a valid session', async () => {
    const anon = new Client();
    expect((await anon.call('GET', '/api/game')).body).toEqual({ state: null });
    expect((await anon.call('GET', '/api/game/radar')).status).toBe(401);
    anon.cookie = 'gps_tag_player=forged-player-id';
    expect((await anon.call('GET', '/api/game')).body).toEqual({ state: null });
    expect((await anon.call('POST', '/api/game/tag', { code: 'AAAAAA' })).status).toBe(401);
  });
});

describe('leaving rooms and games', () => {
  it('removes a waiting guest, allows rejoining with a new membership, and updates start eligibility', async () => {
    const { host, others, code } = await createRoom(['Alice', 'Bob']);
    const bob = others[0]!;
    const before = await bob.state();
    const stale = new Client();
    stale.cookie = bob.cookie;
    expect((await bob.call('POST', '/api/game/leave')).body).toEqual({ state: null });
    expect(bob.cookie).toBe('gps_tag_player=');
    expect(await bob.state()).toBeNull();
    expect(await stale.state()).toBeNull();
    expect((await host.state()).players).toHaveLength(1);
    expect((await host.call('POST', '/api/game/start')).body.error).toBe('NOT_ENOUGH_PLAYERS');
    const rejoined = await bob.call('POST', '/api/games/join', { code, name: 'Bob' });
    expect(rejoined.status).toBe(200);
    expect(rejoined.body.state.me.player_id).not.toBe(before.me.player_id);
  });

  it('frees a full lobby slot', async () => {
    const { others, code } = await createRoom(Array.from({ length: 30 }, (_, i) => `Player ${i}`));
    const next = new Client();
    expect((await next.call('POST', '/api/games/join', { code, name: 'Next' })).body.error).toBe('ROOM_FULL');
    await others[0]!.call('POST', '/api/game/leave');
    expect((await next.call('POST', '/api/games/join', { code, name: 'Next' })).status).toBe(200);
  });

  it.each([['Alice'], ['Alice', 'Bob']])('closes a waiting room when its host exits (%s)', async (...names) => {
    const { host, others, code } = await createRoom(names);
    await host.call('POST', '/api/game/leave');
    expect(await host.state()).toBeNull();
    for (const guest of others) expect(await guest.state()).toBeNull();
    expect(db.prepare('SELECT id FROM games WHERE code = ?').get(code)).toBeUndefined();
    expect((await new Client().call('POST', '/api/games/join', { code, name: 'Late' })).body.error).toBe('ROOM_NOT_FOUND');
  });

  it('removes a departing active player from radar and tagging without losing scores or history', async () => {
    const { host, others, code } = await createRoom(['Alice', 'Bob', 'Cara', 'Dee'], true);
    const [bob, cara, dee] = others as [Client, Client, Client];
    const bobState = await bob.state();
    const caraState = await cara.state();
    await host.call('POST', '/api/game/tag', { code: bobState.me.tag_code });
    await bob.call('POST', '/api/game/tag', { code: caraState.me.tag_code });
    await host.location(1.3, 103.8);
    await bob.location(1.301, 103.8);
    const radarBefore = await host.call('GET', '/api/game/radar');
    expect(radarBefore.body.points.some((p: { player_id: string }) => p.player_id === bobState.me.player_id)).toBe(true);
    const stale = new Client();
    stale.cookie = bob.cookie;
    await bob.call('POST', '/api/game/leave');
    const live = await host.state();
    expect(live.game.status).toBe('active');
    expect(live.players.map((p: { name: string }) => p.name)).toEqual(['Alice', 'Cara', 'Dee']);
    expect(live.events).toHaveLength(2);
    expect(db.prepare('SELECT left_at, latitude, radar_snapshot FROM players WHERE id = ?').get(bobState.me.player_id))
      .toEqual({ left_at: clock, latitude: null, radar_snapshot: null });
    const radarAfter = await host.call('GET', '/api/game/radar');
    expect(radarAfter.body.points.some((p: { player_id: string }) => p.player_id === bobState.me.player_id)).toBe(false);
    expect(radarAfter.body.missing_gps_count).toBe(2);
    expect((await stale.location(1.3, 103.8)).status).toBe(401);
    expect((await stale.call('GET', '/api/game/radar')).status).toBe(401);
    expect((await stale.call('POST', '/api/game/tag', { code: (await dee.state()).me.tag_code })).status).toBe(401);
    expect(await stale.state()).toBeNull();
    for (const input of [{ code: bobState.me.tag_code }, { payload: bobState.me.qr_payload }]) {
      expect((await host.call('POST', '/api/game/tag', input)).body.error).toBe('INVALID_TAG');
    }
    expect((await bob.call('POST', '/api/games/join', { code, name: 'Bob' })).body.error).toBe('ROOM_STARTED');
    const otherRoom = await createRoom(['Eve']);
    expect((await bob.call('POST', '/api/games/join', { code: otherRoom.code, name: 'Bob' })).status).toBe(200);
    await host.call('POST', '/api/game/end');
    const results = await host.state();
    expect(results.players.find((p: { name: string }) => p.name === 'Bob')).toMatchObject({ tag_count: 1, left_at: clock });
    expect(results.players.find((p: { name: string }) => p.name === 'Alice').tag_count).toBe(1);
    expect(results.events).toHaveLength(2);
  });

  it('ends play when the last runner leaves, without inventing a catch', async () => {
    const { host, others } = await createRoom(['Alice', 'Bob'], true);
    await others[0]!.call('POST', '/api/game/leave');
    const state = await host.state();
    expect(state.game).toMatchObject({ status: 'ended', end_reason: 'players_left' });
    expect(state.events).toEqual([]);
    expect(state.players[1]).toMatchObject({ role: 'runner', left_at: clock });
  });

  it('ends play when the host leaves and clears every location and radar cache', async () => {
    const { host, others } = await createRoom(['Alice', 'Bob', 'Cara'], true);
    await host.location(1.3, 103.8);
    await others[0]!.location(1.301, 103.8);
    await host.call('GET', '/api/game/radar');
    await host.call('POST', '/api/game/leave');
    expect(await host.state()).toBeNull();
    const results = await others[0]!.state();
    expect(results.game).toMatchObject({ status: 'ended', end_reason: 'host_left', ended_at: clock });
    expect(results.players[0]).toMatchObject({ name: 'Alice', left_at: clock });
    expect(db.prepare('SELECT COUNT(*) AS n FROM players WHERE latitude IS NOT NULL OR radar_snapshot IS NOT NULL').get()).toEqual({ n: 0 });
  });

  it('excludes earlier withdrawals when the final remaining runner is caught', async () => {
    const { host, others } = await createRoom(['Alice', 'Bob', 'Cara'], true);
    await others[0]!.call('POST', '/api/game/leave');
    expect((await host.state()).game.status).toBe('active');
    await host.call('POST', '/api/game/tag', { code: (await others[1]!.state()).me.tag_code });
    expect((await host.state()).game.status).toBe('ended');
  });

  it('leaves finished results unchanged when someone returns home', async () => {
    const { host, others } = await createRoom(['Alice', 'Bob'], true);
    await host.call('POST', '/api/game/end');
    const before = await others[0]!.state();
    await host.call('POST', '/api/game/leave');
    expect(await host.state()).toBeNull();
    expect(await others[0]!.state()).toEqual(before);
    expect((await host.call('POST', '/api/games', { name: 'Alice' })).status).toBe(200);
  });

  it('accepts repeated, missing, forged and expired sessions and clears the cookie', async () => {
    const { host } = await createRoom(['Alice']);
    const stale = new Client();
    stale.cookie = host.cookie;
    await host.call('POST', '/api/game/leave');
    const forged = new Client();
    forged.cookie = 'gps_tag_player=forged';
    for (const client of [host, stale, forged, new Client()]) {
      const response = await client.call('POST', '/api/game/leave');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ state: null });
      expect(client.cookie).toBe('gps_tag_player=');
    }
  });
});

describe('safe responses', () => {
  it('never exposes other players’ coordinates or tag credentials', async () => {
    const { host, others } = await createRoom(['Alice', 'Bob'], true);
    await host.location(1.3, 103.8);
    await others[0]!.location(1.301, 103.8);
    const bobState = await others[0]!.state();
    const raw = JSON.stringify(await host.state());

    expect(raw).not.toContain('103.8');
    expect(raw).not.toContain('latitude');
    expect(raw).not.toContain(bobState.me.tag_code);
    expect(raw).not.toContain(bobState.me.qr_payload.split(':')[3]);

    const radar = (await host.call('GET', '/api/game/radar')).raw;
    expect(radar).not.toContain('103.8');
    expect(radar).not.toContain(bobState.me.tag_code);
  });
});

describe('location and radar', () => {
  it('validates coordinates', async () => {
    const { host } = await createRoom(['Alice', 'Bob'], true);
    expect((await host.location(91, 0)).body.error).toBe('INVALID_INPUT');
    expect((await host.location(0, 181)).body.error).toBe('INVALID_INPUT');
    expect((await host.call('PUT', '/api/game/location', { lat: '1', lng: 2 })).body.error).toBe('INVALID_INPUT');
    expect((await host.location(0, 0, -5)).body.error).toBe('INVALID_INPUT');
  });

  it('throttles uploads closer than five seconds apart', async () => {
    const { host } = await createRoom(['Alice', 'Bob'], true);
    expect((await host.location(1.3, 103.8)).body.accepted).toBe(true);
    clock += 2_000;
    expect((await host.location(1.31, 103.8)).body.accepted).toBe(false);
    clock += 4_000;
    expect((await host.location(1.31, 103.8)).body.accepted).toBe(true);
  });

  it('waits for an origin fix, then publishes immediately', async () => {
    const { host, others } = await createRoom(['Alice', 'Bob'], true);
    const waiting = (await host.call('GET', '/api/game/radar')).body;
    expect(waiting).toMatchObject({ origin_available: false, next_ping_at: null, missing_gps_count: 1 });

    await host.location(1.3, 103.8);
    await others[0]!.location(1.301, 103.8);
    const radar = (await host.call('GET', '/api/game/radar')).body;
    expect(radar.origin_available).toBe(true);
    expect(radar.next_ping_at).toBe(clock + 5_000);
    expect(radar.points).toHaveLength(1);
    expect(radar.points[0].distance_m).toBeGreaterThan(105);
    expect(radar.points[0].distance_m).toBeLessThan(115);
    expect(radar.points[0].bearing_deg).toBe(0);
  });

  it('caches for five seconds, then publishes moved players', async () => {
    const { host, others } = await createRoom(['Alice', 'Bob'], true);
    const bob = others[0]!;
    await host.location(1.3, 103.8);
    await bob.location(1.301, 103.8);
    const first = (await host.call('GET', '/api/game/radar')).body;

    clock += 2_000;
    const cached = (await host.call('GET', '/api/game/radar')).body;
    expect(cached.points).toEqual(first.points);
    expect(cached.snapshot_at).toBe(first.snapshot_at);
    expect(cached.next_ping_at).toBe(first.next_ping_at);

    clock += 3_000;
    await bob.location(1.3, 103.801);
    await host.location(1.3, 103.8);
    const next = (await host.call('GET', '/api/game/radar')).body;
    expect(next.snapshot_at).toBe(clock);
    expect(next.points[0].bearing_deg).toBe(90);
  });

  it('counts players outside 500 m and drops fixes older than 30 seconds', async () => {
    const { host, others } = await createRoom(['Alice', 'Bob', 'Cat'], true);
    const [bob, cat] = others as [Client, Client];
    await bob.location(1.3, 103.8);
    clock += 100_000;
    await host.location(1.3, 103.8);
    await cat.location(1.32, 103.8);
    clock += 30_000;
    const radar = (await host.call('GET', '/api/game/radar')).body;
    expect(radar.points).toHaveLength(0);
    expect(radar.outside_range_count).toBe(1);
    expect(radar.missing_gps_count).toBe(1);
  });

  it('stores capture time separately and throttles by receipt time', async () => {
    const { host } = await createRoom(['Alice', 'Bob'], true);
    const first = (await host.location(1.3, 103.8, 10, clock - 20_000)).body;
    expect(first).toMatchObject({ accepted: true, reason: 'accepted', next_upload_at: clock + 5_000, server_now: clock });
    const row = db.prepare('SELECT captured_at, location_at FROM players WHERE captured_at IS NOT NULL').get();
    expect(row).toEqual({ captured_at: clock - 20_000, location_at: clock });
    clock += 1_000;
    expect((await host.location(1.3, 103.8)).body).toMatchObject({ accepted: false, reason: 'throttled', next_upload_at: clock + 4_000 });
  });

  it('rejects duplicates, older, expired, invalid and materially future samples', async () => {
    const { host } = await createRoom(['Alice', 'Bob'], true);
    const captured = clock;
    await host.location(1.3, 103.8);
    clock += 6_000;
    expect((await host.location(1.4, 103.8, 10, captured)).body.reason).toBe('older');
    expect((await host.location(1.4, 103.8, 10, captured - 1)).body.reason).toBe('older');
    expect((await host.location(1.4, 103.8, 10, clock - 30_001)).body.reason).toBe('expired');
    expect((await host.location(1.4, 103.8, 10, clock + 5_001)).body.reason).toBe('future');
    expect((await host.call('PUT', '/api/game/location', { lat: 1, lng: 2, captured_at: 'yesterday' })).status).toBe(400);
    expect(db.prepare('SELECT latitude FROM players WHERE captured_at IS NOT NULL').get()).toEqual({ latitude: 1.3 });
    expect((await host.location(1.31, 103.8, 10, clock + 2_000)).body.accepted).toBe(true);
    expect(db.prepare('SELECT captured_at FROM players WHERE captured_at IS NOT NULL').get()).toEqual({ captured_at: clock });
  });

  it('includes both accuracies and the actual capture ages', async () => {
    const { host, others } = await createRoom(['Alice', 'Bob'], true);
    await host.location(1.3, 103.8, 60, clock - 8_000);
    await others[0]!.location(1.301, 103.8, 5, clock - 3_000);
    const radar = (await host.call('GET', '/api/game/radar')).body;
    expect(radar).toMatchObject({ origin_captured_at: clock - 8_000, origin_accuracy_m: 60 });
    expect(radar.points[0]).toMatchObject({ uncertainty_m: 65, captured_at: clock - 3_000, fix_age_s: 3, position_uncertain: false });
  });

  it('marks overlapping, unknown-accuracy and boundary positions uncertain', async () => {
    const { host, others } = await createRoom(['Alice', 'Overlap', 'Unknown', 'Boundary'], true);
    await host.location(0, 0, 50);
    await others[0]!.location(0.0001, 0, 10);
    await others[1]!.location(0.001, 0, null);
    await others[2]!.location(0.0047, 0, 10); // ~523 m, but the 60 m uncertainty overlaps 500 m.
    const radar = (await host.call('GET', '/api/game/radar')).body;
    expect(radar.points).toHaveLength(3);
    expect(radar.outside_range_count).toBe(0);
    expect(radar.points.every((p: { position_uncertain: boolean }) => p.position_uncertain)).toBe(true);
    expect(radar.points[1].uncertainty_m).toBeNull();
  });

  it('accepts legacy clients but marks their capture age unknown', async () => {
    const { host, others } = await createRoom(['Alice', 'Bob'], true);
    await host.location(1.3, 103.8);
    const legacy = await others[0]!.call('PUT', '/api/game/location', { lat: 1.301, lng: 103.8, accuracy: 5 });
    expect(legacy.body.accepted).toBe(true);
    const radar = (await host.call('GET', '/api/game/radar')).body;
    expect(radar.points[0]).toMatchObject({ captured_at: null, position_uncertain: true });
    const reversed = (await others[0]!.call('GET', '/api/game/radar')).body;
    expect(reversed.origin_captured_at).toBeNull();
    expect(reversed.points[0].position_uncertain).toBe(true);
  });

  it('expires a cached target even within the five-second cache interval', async () => {
    const { host, others } = await createRoom(['Alice', 'Bob'], true);
    await host.location(1.3, 103.8);
    await others[0]!.location(1.301, 103.8, 10, clock - 29_000);
    expect((await host.call('GET', '/api/game/radar')).body.points).toHaveLength(1);
    clock += 2_000;
    const radar = (await host.call('GET', '/api/game/radar')).body;
    expect(radar.points).toHaveLength(0); expect(radar.missing_gps_count).toBe(1);
  });

  it('expires a cached origin even with fresh targets', async () => {
    const { host, others } = await createRoom(['Alice', 'Bob'], true);
    await host.location(1.3, 103.8, 10, clock - 29_000);
    await others[0]!.location(1.301, 103.8);
    expect((await host.call('GET', '/api/game/radar')).body.points).toHaveLength(1);
    clock += 2_000;
    expect((await host.call('GET', '/api/game/radar')).body).toMatchObject({ origin_available: false, points: [] });
  });

  it('rejects a late location upload after the game ends', async () => {
    const { host, others } = await createRoom(['Alice', 'Bob'], true);
    await host.call('POST', '/api/game/end');
    expect((await others[0]!.location(1.3, 103.8)).body.error).toBe('GAME_NOT_ACTIVE');
    const count = db.prepare(`SELECT COUNT(*) AS n FROM players WHERE latitude IS NOT NULL`).get() as { n: number };
    expect(count.n).toBe(0);
  });
});

describe('tagging', () => {
  it('only lets catchers tag', async () => {
    const { host, others } = await createRoom(['Alice', 'Bob'], true);
    const hostState = await host.state();
    const res = await others[0]!.call('POST', '/api/game/tag', { code: hostState.me.tag_code });
    expect(res.body.error).toBe('NOT_CATCHER');
  });

  it('converts a runner by QR payload and records one event', async () => {
    const { host, others } = await createRoom(['Alice', 'Bob', 'Cat'], true);
    const bob = await others[0]!.state();
    const res = await host.call('POST', '/api/game/tag', { payload: bob.me.qr_payload });
    expect(res.body.result).toEqual({ outcome: 'tagged', target_name: 'Bob' });
    expect(res.body.state.game.status).toBe('active');
    const after = await others[0]!.state();
    expect(after.me.role).toBe('catcher');
    expect(after.events).toHaveLength(1);
    expect(after.players.find((p: { name: string }) => p.name === 'Alice').tag_count).toBe(1);
  });

  it('makes repeated and racing tags harmless', async () => {
    const { host, others } = await createRoom(['Alice', 'Bob', 'Cat', 'Dan'], true);
    const [bob, cat] = others as [Client, Client];
    const catState = await cat.state();
    await host.call('POST', '/api/game/tag', { code: (await bob.state()).me.tag_code });

    const results = await Promise.all([
      host.call('POST', '/api/game/tag', { code: catState.me.tag_code }),
      bob.call('POST', '/api/game/tag', { code: catState.me.tag_code }),
      host.call('POST', '/api/game/tag', { payload: catState.me.qr_payload }),
    ]);
    const outcomes = results.map((r) => r.body.result.outcome).sort();
    expect(outcomes).toEqual(['already_tagged', 'already_tagged', 'tagged']);

    const events = db.prepare(`SELECT COUNT(*) AS n FROM tag_events`).get() as { n: number };
    expect(events.n).toBe(2);
    const state = await host.state();
    const totalTags = state.players.reduce((sum: number, p: { tag_count: number }) => sum + p.tag_count, 0);
    expect(totalTags).toBe(2);
  });

  it('rejects QR codes from another room or with a bad token, and unknown manual codes', async () => {
    const roomA = await createRoom(['Alice', 'Bob'], true);
    const roomB = await createRoom(['Xena', 'Yuri'], true);
    const yuri = await roomB.others[0]!.state();

    const crossRoom = await roomA.host.call('POST', '/api/game/tag', { payload: yuri.me.qr_payload });
    expect(crossRoom.body.error).toBe('INVALID_TAG');

    const bob = await roomA.others[0]!.state();
    const forged = bob.me.qr_payload.replace(/:[^:]+$/, ':not-the-token');
    expect((await roomA.host.call('POST', '/api/game/tag', { payload: forged })).body.error).toBe('INVALID_TAG');
    expect((await roomA.host.call('POST', '/api/game/tag', { payload: 'https://example.com' })).body.error).toBe(
      'INVALID_TAG',
    );

    const wrongCode = yuri.me.tag_code === bob.me.tag_code ? 'AAAAAA' : yuri.me.tag_code;
    expect((await roomA.host.call('POST', '/api/game/tag', { code: wrongCode })).body.error).toBe('INVALID_TAG');
    expect((await roomA.others[0]!.state()).me.role).toBe('runner');
  });

  it('ends the game and clears locations and radar caches when the last runner is caught', async () => {
    const { host, others } = await createRoom(['Alice', 'Bob'], true);
    await host.location(1.3, 103.8);
    await others[0]!.location(1.301, 103.8);
    await host.call('GET', '/api/game/radar');

    const bob = await others[0]!.state();
    const res = await host.call('POST', '/api/game/tag', { code: bob.me.tag_code.toLowerCase() });
    expect(res.body.result.outcome).toBe('tagged');
    expect(res.body.state.game.status).toBe('ended');
    expect(res.body.state.game.ended_at).toBe(clock);
    expect((await others[0]!.state()).game.status).toBe('ended');

    const leftovers = db
      .prepare(`SELECT COUNT(*) AS n FROM players WHERE latitude IS NOT NULL OR captured_at IS NOT NULL OR location_at IS NOT NULL OR radar_snapshot IS NOT NULL`)
      .get() as { n: number };
    expect(leftovers.n).toBe(0);
    expect((await host.call('POST', '/api/game/tag', { code: bob.me.tag_code })).body.error).toBe('GAME_NOT_ACTIVE');
  });

  it('lets the host end early and clears positions', async () => {
    const { host, others } = await createRoom(['Alice', 'Bob'], true);
    await others[0]!.location(1.3, 103.8);
    const res = await host.call('POST', '/api/game/end');
    expect(res.body.state.game.status).toBe('ended');
    const n = db.prepare(`SELECT COUNT(*) AS n FROM players WHERE latitude IS NOT NULL`).get() as { n: number };
    expect(n.n).toBe(0);
  });
});

describe('cleanup', () => {
  it('deletes games older than the retention window', async () => {
    const { host } = await createRoom(['Alice', 'Bob'], true);
    clock += GAME_RETENTION_MS + 1;
    const { service } = await buildApp({ db, config, now: () => clock, rateLimit: false });
    expect(service.cleanup().deletedGames).toBe(1);
    expect(await host.state()).toBeNull();
  });
});

describe('health', () => {
  it('reports healthy', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ ok: true });
  });
});

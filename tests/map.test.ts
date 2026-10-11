import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildApp } from '../server/app.js';
import { openDb, type Db } from '../server/db.js';
import type { MapResponse } from '../server/game/map.js';

let db: Db;
let app: FastifyInstance;
let clock: number;
beforeEach(async () => {
  clock = Date.UTC(2026, 9, 11);
  db = openDb(':memory:');
  ({ app } = await buildApp({ db, config: { cookieSecret: 'map-test-secret-map-test-secret-0000', cookieSecure: false, clientDir: null }, now: () => clock, rateLimit: false }));
});
afterEach(async () => { await app.close(); db.close(); });

async function call(method: 'GET' | 'POST' | 'PUT', url: string, cookie = '', payload?: unknown) {
  const res = await app.inject({ method, url, headers: { cookie, ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}) },
    payload: method === 'GET' ? undefined : JSON.stringify(payload ?? {}) });
  return { status: res.statusCode, body: res.json(), headers: res.headers,
    cookie: String(res.headers['set-cookie'] ?? '').split(';')[0]! };
}
async function room(start = true) {
  const host = await call('POST', '/api/games', '', { name: 'Host' });
  const runner = await call('POST', '/api/games/join', '', { name: 'Runner', code: host.body.state.game.code });
  if (start) await call('POST', '/api/game/start', host.cookie);
  return { host, runner };
}
async function location(cookie: string, lat: number, accuracy: number | null = 10, captured_at: number | null = clock) {
  await call('PUT', '/api/game/location', cookie, { lat, lng: 103.8, accuracy, captured_at });
}

it('shares only same-game fresh locations including self and players beyond radar range', async () => {
  const { host, runner } = await room();
  const outsider = await room();
  await location(host.cookie, 1.3);
  await location(runner.cookie, 1.4);
  await location(outsider.host.cookie, 1.5);
  const result = await call('GET', '/api/game/map', host.cookie);
  const map = result.body as MapResponse;
  expect(result.status).toBe(200);
  expect(result.headers['cache-control']).toBe('no-store');
  expect(map.points.map((p) => p.lat).sort()).toEqual([1.3, 1.4]);
  expect(map.points.map((p) => p.player_id)).toContain(host.body.state.me.player_id);
  expect(map).toMatchObject({ server_now: clock, snapshot_at: clock, unavailable_player_ids: [] });
  expect(JSON.stringify(map)).not.toContain(runner.body.state.me.tag_code);
  expect(JSON.stringify(map)).not.toContain(runner.body.state.me.qr_payload);
  expect((await call('GET', '/api/game/radar', host.cookie)).body.points).toEqual([]);
});

it('does not require the viewer to have GPS and omits unknown accuracy, legacy and expired readings', async () => {
  const { host, runner } = await room();
  await location(runner.cookie, 1.4);
  let map = (await call('GET', '/api/game/map', host.cookie)).body as MapResponse;
  expect(map.points).toHaveLength(1);
  expect(map.unavailable_player_ids).toEqual([host.body.state.me.player_id]);
  clock += 30_000;
  expect((await call('GET', '/api/game/map', host.cookie)).body.points).toHaveLength(1);
  clock++;
  expect((await call('GET', '/api/game/map', host.cookie)).body.points).toEqual([]);
  await location(host.cookie, 1.3, null);
  await location(runner.cookie, 1.4, 10, null);
  map = (await call('GET', '/api/game/map', host.cookie)).body;
  expect(map.points).toEqual([]);
  expect(map.unavailable_player_ids).toHaveLength(2);
});

it('rejects anonymous, forged, waiting and ended-game access', async () => {
  expect((await call('GET', '/api/game/map')).status).toBe(401);
  expect((await call('GET', '/api/game/map', 'gps_tag_player=forged')).status).toBe(401);
  const { host } = await room(false);
  expect((await call('GET', '/api/game/map', host.cookie)).body.error).toBe('GAME_NOT_ACTIVE');
  await call('POST', '/api/game/start', host.cookie);
  await location(host.cookie, 1.3);
  await call('POST', '/api/game/end', host.cookie);
  expect((await call('GET', '/api/game/map', host.cookie)).body.error).toBe('GAME_NOT_ACTIVE');
});

it('removes departed players and rejects their old cookie', async () => {
  const { host, runner } = await room(false);
  await call('POST', '/api/games/join', '', { name: 'Other runner', code: host.body.state.game.code });
  await call('POST', '/api/game/start', host.cookie);
  await location(runner.cookie, 1.4);
  await call('POST', '/api/game/leave', runner.cookie);
  const map = (await call('GET', '/api/game/map', host.cookie)).body as MapResponse;
  expect(map.points).toEqual([]);
  expect(map.unavailable_player_ids).not.toContain(runner.body.state.me.player_id);
  expect((await call('GET', '/api/game/map', runner.cookie)).status).toBe(401);
});

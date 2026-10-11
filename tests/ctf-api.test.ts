import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server/app.js';
import { openDb, type Db } from '../server/db.js';

const config = { cookieSecret: 'test-secret-test-secret-test-secret-0000', cookieSecure: false, clientDir: null };
let db: Db, app: FastifyInstance, clock: number;
beforeEach(async () => {
  clock = 1_800_000_000_000; db = openDb(':memory:');
  ({ app } = await buildApp({ db, config, now: () => clock }));
});
afterEach(async () => { await app.close(); db.close(); });
function call(url: string, method: 'GET' | 'POST' | 'PUT' = 'GET', cookie = '', payload?: unknown) {
  return app.inject({ url, method, headers: { cookie, ...(method === 'GET' ? {} : { 'content-type': 'application/json' }) },
    payload: method === 'GET' ? undefined : JSON.stringify(payload ?? {}) });
}
const cookieFrom = (res: { headers: Record<string, unknown> }) => String(res.headers['set-cookie']).split(';')[0]!;

it('keeps both game sessions and settings independent, including leave', async () => {
  const original = await call('/api/games', 'POST', '', { name: 'Original Host' });
  const originalCookie = cookieFrom(original);
  await call('/api/game/settings', 'PUT', originalCookie, { duration_minutes: 90 });
  const before = (await call('/api/game', 'GET', originalCookie)).json();
  const created = await call('/api/ctf/create', 'POST', originalCookie, { name: 'CTF Host' });
  expect(created.statusCode).toBe(200);
  expect(created.headers['set-cookie']).toContain('ctf_player=');
  expect(created.headers['set-cookie']).toContain('Path=/api/ctf');
  expect(created.headers['set-cookie']).not.toContain('gps_tag_player=');
  const both = `${originalCookie}; ${cookieFrom(created)}`;
  expect((await call('/api/game', 'GET', both)).json()).toEqual(before);
  expect((await call('/api/ctf/state', 'GET', originalCookie)).json().state).toBeNull();
  expect((await call('/api/game', 'GET', cookieFrom(created))).json().state).toBeNull();
  const left = await call('/api/ctf/leave', 'POST', both);
  expect(left.headers['set-cookie']).toContain('ctf_player=;');
  expect((await call('/api/game', 'GET', originalCookie)).json()).toEqual(before);
});

it('enforces API setup authorization and completes a separate room lifecycle', async () => {
  const created = await call('/api/ctf/create', 'POST', '', { name: 'Host' });
  const host = cookieFrom(created), code = created.json().state.game.code;
  const joined = await call('/api/ctf/join', 'POST', '', { name: 'Runner', code });
  const runner = cookieFrom(joined);
  expect((await call('/api/ctf/setup/start', 'POST', runner)).statusCode).toBe(403);
  expect((await call('/api/ctf/setup/start', 'POST', host)).json().error).toBe('GPS_REQUIRED');
  const gps = { lat: 1.3, lng: 103.8, accuracy: 5, captured_at: clock };
  for (const cookie of [host, runner]) expect((await call('/api/ctf/location', 'PUT', cookie, gps)).json().accepted).toBe(true);
  const setup = await call('/api/ctf/setup/start', 'POST', host);
  const saved = await call('/api/ctf/setup/checkpoints', 'PUT', host, { setup_version: setup.json().state.game.setup_version,
    checkpoints: [ { name: 'North', lat: 1.3004, lng: 103.8 }, { name: 'East', lat: 1.2996, lng: 103.8003 }, { name: 'West', lat: 1.2996, lng: 103.7997 } ] });
  expect(saved.statusCode).toBe(200);
  expect((await call('/api/ctf/start', 'POST', runner)).statusCode).toBe(403);
  expect((await call('/api/ctf/start', 'POST', host)).json().state.game.status).toBe('active');
  expect((await call('/api/ctf/setup/start', 'POST', host)).statusCode).toBe(409);
  const result = await call('/api/ctf/tag', 'POST', host, { code: joined.json().state.me.tag_code });
  expect(result.json().state.game).toMatchObject({ status: 'ended', outcome: 'all_caught' });
  expect(result.headers['cache-control']).toBe('no-store');
});

it('uses its own rate-limit bucket and never consumes the original game bucket', async () => {
  const created = await call('/api/ctf/create', 'POST', '', { name: 'Host' });
  const cookie = cookieFrom(created);
  for (let i = 0; i < 10; i++) expect((await call('/api/ctf/landmarks', 'GET', cookie)).statusCode).toBe(400);
  expect((await call('/api/ctf/landmarks', 'GET', cookie)).statusCode).toBe(429);
  for (let i = 0; i < 120; i++) expect((await call('/api/ctf/state', 'GET', cookie)).statusCode).toBe(200);
  expect((await call('/api/ctf/state', 'GET', cookie)).statusCode).toBe(429);
  expect((await call('/api/game')).statusCode).toBe(200);
});

it('requires a signed CTF session and exposes no other player tag credentials', async () => {
  expect((await call('/api/ctf/start', 'POST')).statusCode).toBe(401);
  expect((await call('/api/ctf/start', 'POST', 'ctf_player=forged')).statusCode).toBe(401);
  const created = await call('/api/ctf/create', 'POST', '', { name: 'Host' });
  const joined = await call('/api/ctf/join', 'POST', '', { name: 'Runner', code: created.json().state.game.code });
  const state = (await call('/api/ctf/state', 'GET', cookieFrom(created))).json().state;
  expect(state.players).toHaveLength(2);
  expect(JSON.stringify(state.players)).not.toContain(joined.json().state.me.tag_code);
  expect(JSON.stringify(state.players)).not.toContain('token');
});

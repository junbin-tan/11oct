import type { FastifyInstance } from 'fastify';
import type { InjectOptions } from 'light-my-request';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../server/app.js';
import { openDb, type Db } from '../server/db.js';
import { CREATE_JOIN_LIMIT, PLAYER_REQUEST_LIMIT, TAG_LIMIT } from '../server/limits.js';

const config = { cookieSecret: 'test-secret-test-secret-test-secret-0000', cookieSecure: false, clientDir: null };

let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
  db = openDb(':memory:');
  ({ app } = await buildApp({ db, config, rateLimit: true }));
});

afterEach(async () => {
  await app.close();
  db.close();
});

function cookieOf(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';')[0]!;
}

async function inject(options: InjectOptions) {
  const res = await app.inject(options);
  return { status: res.statusCode, body: res.json(), headers: res.headers };
}

describe('rate limits', () => {
  it('lets a full shared network poll and upload without limiting signed players', async () => {
    const players = [];
    for (let i = 0; i < 30; i++) {
      const created = await inject({
        method: 'POST',
        url: '/api/games',
        headers: { 'content-type': 'application/json' },
        payload: { name: `P${i}` },
      });
      expect(created.status).toBe(200);
      players.push(cookieOf(created));
    }

    for (const cookie of players) {
      for (let n = 0; n < 5; n++) {
        const state = await inject({ method: 'GET', url: '/api/game', headers: { cookie } });
        expect(state.status).toBe(200);
      }
      const location = await inject({
        method: 'PUT',
        url: '/api/game/location',
        headers: { cookie, 'content-type': 'application/json' },
        payload: { lat: 1.3, lng: 103.8, accuracy: 10 },
      });
      expect(location.status).toBe(200);
    }
  });

  it('supports a 30-player round at five-second location/radar cadence for a full minute', async () => {
    await app.close();
    let clock = Date.now();
    ({ app } = await buildApp({ db, config, now: () => clock, rateLimit: true }));
    const host = await inject({ method: 'POST', url: '/api/games', headers: { 'content-type': 'application/json' }, payload: { name: 'Host' } });
    const players = [cookieOf(host)];
    const code = host.body.state.game.code;
    for (let i = 1; i < 30; i++) {
      const joined = await inject({ method: 'POST', url: '/api/games/join', headers: { 'content-type': 'application/json' }, payload: { code, name: `P${i}` } });
      expect(joined.status).toBe(200); players.push(cookieOf(joined));
    }
    expect((await inject({ method: 'POST', url: '/api/game/start', headers: { cookie: players[0], 'content-type': 'application/json' }, payload: {} })).status).toBe(200);
    for (let second = 0; second < 60; second++) {
      // Simulate game time while keeping the entire workload inside the limiter's real window.
      if (second % 5 === 0) {
        for (const [i, cookie] of players.entries()) {
          const location = await inject({ method: 'PUT', url: '/api/game/location', headers: { cookie, 'content-type': 'application/json' },
            payload: { lat: 1.3 + i * 0.00001, lng: 103.8, accuracy: 5, captured_at: clock } });
          expect(location.status).toBe(200); expect(location.body.accepted).toBe(true);
        }
        for (const cookie of players) {
          const radar = await inject({ method: 'GET', url: '/api/game/radar', headers: { cookie } });
          expect(radar.status).toBe(200); expect(radar.body.points).toHaveLength(29);
          expect(radar.body.next_ping_at).toBe(clock + 5_000);
        }
      }
      if (second % 3 === 0) {
        for (const cookie of players) expect((await inject({ method: 'GET', url: '/api/game', headers: { cookie } })).status).toBe(200);
      }
      clock += 1_000;
    }
  });

  it('limits one signed player independently of the shared network', async () => {
    const created = await inject({
      method: 'POST',
      url: '/api/games',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'Solo' },
    });
    const cookie = cookieOf(created);
    let limited = 0;
    for (let n = 0; n < PLAYER_REQUEST_LIMIT + 1; n++) {
      const res = await inject({ method: 'GET', url: '/api/game', headers: { cookie } });
      if (res.status === 429) limited++;
      else expect(res.status).toBe(200);
    }
    expect(limited).toBe(1);
  });

  it('bounds anonymous room creation by the nearest forwarded client', async () => {
    const hit = (left: string, right = '203.0.113.50') =>
      inject({
        method: 'POST',
        url: '/api/games',
        remoteAddress: '10.0.0.8',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': `${left}, ${right}`,
          'x-real-ip': right,
        },
        payload: { name: 'Joiner' },
      });

    for (let n = 0; n < CREATE_JOIN_LIMIT; n++) {
      expect((await hit(`198.51.100.${n}`)).status).toBe(200);
    }
    expect((await hit('198.51.100.200')).status).toBe(429);
    expect((await hit('203.0.113.77', '203.0.113.51')).status).toBe(200);
  });

  it('applies a stricter per-player tag limit', async () => {
    const host = await inject({
      method: 'POST',
      url: '/api/games',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'Host' },
    });
    const code = host.body.state.game.code as string;
    const runner = await inject({
      method: 'POST',
      url: '/api/games/join',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'Runner', code },
    });
    expect((await inject({
      method: 'POST',
      url: '/api/games/join',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'Extra', code },
    })).status).toBe(200);
    const hostCookie = cookieOf(host);
    expect((await inject({
      method: 'POST',
      url: '/api/game/start',
      headers: { cookie: hostCookie, 'content-type': 'application/json' },
      payload: {},
    })).status).toBe(200);

    const tagCode = runner.body.state.me.tag_code as string;
    let limited = 0;
    for (let n = 0; n < TAG_LIMIT + 1; n++) {
      const res = await inject({
        method: 'POST',
        url: '/api/game/tag',
        headers: { cookie: hostCookie, 'content-type': 'application/json' },
        payload: { code: tagCode },
      });
      if (res.status === 429) limited++;
      else expect(res.status).toBe(200);
    }
    expect(limited).toBe(1);
  });
});

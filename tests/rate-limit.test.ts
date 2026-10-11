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

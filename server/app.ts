import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { GameError } from './errors.js';
import { GameService } from './game/service.js';
import { PLAYER_REQUEST_LIMIT, RATE_WINDOW } from './limits.js';
import { clientAddress, trustNearestProxy } from './proxy.js';
import { gameRoutes, SESSION_COOKIE } from './routes/game.js';

export interface AppOptions {
  db: Db;
  config: Pick<Config, 'cookieSecret' | 'cookieSecure' | 'clientDir'>;
  now?: () => number;
  rateLimit?: boolean;
  logger?: boolean;
}

export function rateLimitKey(request: FastifyRequest): string {
  const raw = request.cookies[SESSION_COOKIE];
  if (typeof raw === 'string' && raw.length > 0) {
    const unsigned = request.unsignCookie(raw);
    if (unsigned.valid && unsigned.value) return `player:${unsigned.value}`;
  }
  return `ip:${clientAddress(request.headers, request.ip)}`;
}

export async function buildApp({ db, config, now, rateLimit = true, logger = false }: AppOptions) {
  const app = Fastify({ logger, trustProxy: trustNearestProxy, bodyLimit: 16 * 1024 });
  const service = new GameService(db, now);

  await app.register(fastifyCookie, { secret: config.cookieSecret });
  if (rateLimit) {
    await app.register(fastifyRateLimit, {
      max: PLAYER_REQUEST_LIMIT,
      timeWindow: RATE_WINDOW,
      keyGenerator: rateLimitKey,
      allowList: (request) => request.url === '/health' || request.url === '/api/health',
    });
  }

  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'GET' || request.method === 'HEAD') return;
    if (!request.headers['content-type']?.startsWith('application/json')) {
      return reply.code(415).send({ error: 'INVALID_INPUT', message: 'Requests must be JSON.' });
    }
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof GameError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    const status = error.statusCode ?? 500;
    if (status >= 500) request.log.error(error);
    return reply.code(status).send({
      error: status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'SERVER_ERROR' : 'INVALID_INPUT',
      message: status >= 500 ? 'Something went wrong.' : error.message,
    });
  });

  const health = async () => {
    db.prepare('SELECT 1').get();
    return { ok: true };
  };
  app.get('/health', health);
  app.get('/api/health', health);

  await app.register(gameRoutes, { service, cookieSecure: config.cookieSecure });

  if (config.clientDir) {
    await app.register(fastifyStatic, {
      root: config.clientDir,
      setHeaders(res, filePath) {
        res.header(
          'cache-control',
          filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (config.clientDir && request.method === 'GET' && !request.url.startsWith('/api')) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'NOT_FOUND', message: 'Not found.' });
  });

  return { app, service };
}

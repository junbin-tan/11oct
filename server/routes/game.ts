import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { GameService, LocationInput, TagInput } from '../game/service.js';
import { GameError } from '../errors.js';

export const SESSION_COOKIE = 'gps_tag_player';
const SESSION_MAX_AGE_S = 24 * 60 * 60;

interface RouteOptions {
  service: GameService;
  cookieSecure: boolean;
}

export async function gameRoutes(app: FastifyInstance, { service, cookieSecure }: RouteOptions) {
  const sessionPlayerId = (request: FastifyRequest): string | null => {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return null;
    const unsigned = request.unsignCookie(raw);
    return unsigned.valid ? unsigned.value : null;
  };

  const requirePlayerId = (request: FastifyRequest): string => {
    const id = sessionPlayerId(request);
    if (!id) throw new GameError('NOT_IN_ROOM', 'You are not in a game.');
    return id;
  };

  const setSession = (reply: FastifyReply, playerId: string) => {
    reply.setCookie(SESSION_COOKIE, playerId, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure,
      path: '/',
      maxAge: SESSION_MAX_AGE_S,
    });
  };

  const stateFor = (playerId: string) => {
    const state = service.getState(playerId);
    if (!state) throw new GameError('NOT_IN_ROOM', 'You are not in a game.');
    return state;
  };

  const strict = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  app.get('/api/game', async (request) => {
    const playerId = sessionPlayerId(request);
    return { state: playerId ? service.getState(playerId) : null };
  });

  app.post<{ Body: { name?: unknown } }>('/api/games', strict, async (request, reply) => {
    const { playerId } = service.createGame(request.body?.name);
    setSession(reply, playerId);
    return { state: stateFor(playerId) };
  });

  app.post<{ Body: { code?: unknown; name?: unknown } }>('/api/games/join', strict, async (request, reply) => {
    const { playerId } = service.joinGame(sessionPlayerId(request), request.body?.code, request.body?.name);
    setSession(reply, playerId);
    return { state: stateFor(playerId) };
  });

  app.post('/api/game/start', async (request) => {
    const playerId = requirePlayerId(request);
    service.startGame(playerId);
    return { state: stateFor(playerId) };
  });

  app.post('/api/game/end', async (request) => {
    const playerId = requirePlayerId(request);
    service.endGame(playerId);
    return { state: stateFor(playerId) };
  });

  app.put<{ Body: LocationInput }>('/api/game/location', async (request) => {
    return service.updateLocation(requirePlayerId(request), request.body ?? ({} as LocationInput));
  });

  app.get('/api/game/radar', async (request) => {
    return service.getRadar(requirePlayerId(request));
  });

  app.post<{ Body: TagInput }>(
    '/api/game/tag',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const playerId = requirePlayerId(request);
      const result = service.tag(playerId, request.body ?? {});
      return { result, state: stateFor(playerId) };
    },
  );
}

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db.js';
import { clientAddress } from '../proxy.js';
import { LandmarkLookup } from './landmarks.js';
import { CtfError } from './rules.js';
import { CtfService } from './service.js';

export const CTF_COOKIE = 'ctf_player';
interface Options { db: Db; cookieSecure: boolean; now?: () => number }

/** Encapsulation keeps errors, cookies, rate limits and lifecycle separate from the original game. */
export async function ctfRoutes(app: FastifyInstance, { db, cookieSecure, now }: Options) {
  const service = new CtfService(db, now), landmarks = new LandmarkLookup();
  const session = (request: FastifyRequest) => {
    const raw = request.cookies[CTF_COOKIE];
    if (!raw) return null;
    const parsed = request.unsignCookie(raw);
    return parsed.valid ? parsed.value : null;
  };
  const required = (request: FastifyRequest) => {
    const id = session(request);
    if (!id) throw new CtfError('NOT_IN_ROOM', 'Join a Capture the Flag room first.', 401);
    return id;
  };
  const cookieOptions = { signed: true, httpOnly: true, sameSite: 'lax' as const, secure: cookieSecure, path: '/api/ctf', maxAge: 24 * 60 * 60 };
  const setSession = (reply: FastifyReply, id: string) => reply.setCookie(CTF_COOKIE, id, cookieOptions);
  const limits = (action: string) => ({ config: { rateLimit: {
      max: action === 'landmarks' ? 10 : action === 'tag' ? 30 : action === 'create' || action === 'join' ? 40 : 120,
      timeWindow: '1 minute',
      keyGenerator: (request: FastifyRequest) => `ctf:${action === 'create' || action === 'join'
        ? clientAddress(request.headers, request.ip) : session(request) ?? clientAddress(request.headers, request.ip)}:${action}`,
  } } });
  app.addHook('onSend', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof CtfError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status >= 500) request.log.error(error);
    return reply.code(status).send({ error: status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR', message: status >= 500 ? 'Capture the Flag could not complete that request.' : error.message });
  });
  app.get('/api/ctf/state', limits('state'), async request => ({ state: service.state(session(request)), server_now: (now ?? Date.now)() }));
  app.post<{ Body: { name?: unknown } }>('/api/ctf/create', limits('create'), async (request, reply) => {
    const id = service.create(request.body?.name, session(request)); setSession(reply, id);
    return { state: service.state(id) };
  });
  app.post<{ Body: { name?: unknown; code?: unknown } }>('/api/ctf/join', limits('join'), async (request, reply) => {
    const id = service.join(request.body?.name, request.body?.code, session(request)); setSession(reply, id);
    return { state: service.state(id) };
  });
  app.post('/api/ctf/leave', limits('leave'), async (request, reply) => {
    service.leave(session(request)); reply.clearCookie(CTF_COOKIE, { ...cookieOptions, maxAge: undefined });
    return { state: null };
  });
  app.put<{ Body: Parameters<CtfService['location']>[1] }>('/api/ctf/location', limits('location'), async request => service.location(required(request), request.body ?? {}));
  app.post('/api/ctf/setup/start', limits('setup-start'), async request => {
    const id = required(request); service.setupStart(id); return { state: service.state(id) };
  });
  app.get('/api/ctf/landmarks', limits('landmarks'), async request => {
    const origin = service.landmarkOrigin(required(request));
    return { ...await landmarks.find(origin.start), setup_version: origin.setup_version };
  });
  app.put<{ Body: { setup_version?: unknown; checkpoints?: unknown } }>('/api/ctf/setup/checkpoints', limits('checkpoints'), async request => {
    const id = required(request); service.saveCheckpoints(id, request.body?.setup_version, request.body?.checkpoints);
    return { state: service.state(id) };
  });
  app.post('/api/ctf/start', limits('start'), async request => {
    const id = required(request); service.start(id); return { state: service.state(id) };
  });
  app.post('/api/ctf/end', limits('end'), async request => {
    const id = required(request); service.end(id); return { state: service.state(id) };
  });
  app.post<{ Body: Parameters<CtfService['tag']>[1] }>('/api/ctf/tag', limits('tag'), async request => {
    const id = required(request), result = service.tag(id, request.body ?? {});
    return { result, state: service.state(id) };
  });
  service.cleanup();
  const tick = setInterval(() => { try { service.tick(); } catch (error) { app.log.error(error, 'CTF tick failed'); } }, 1_000);
  const cleanup = setInterval(() => { try { service.cleanup(); } catch (error) { app.log.error(error, 'CTF cleanup failed'); } }, 60_000);
  tick.unref(); cleanup.unref();
  app.addHook('onClose', async () => { clearInterval(tick); clearInterval(cleanup); });
}

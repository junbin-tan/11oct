import type { GameState, LocationAck, MapResponse, RadarResponse, TagResult } from './types';

const MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: 'No game with that code.',
  ROOM_STARTED: 'That game has already started.',
  ROOM_ENDED: 'That game has ended.',
  ROOM_FULL: 'That game is full.',
  NOT_IN_ROOM: 'You are not in a game.',
  HOST_ONLY: 'Only the host can do that.',
  NOT_ENOUGH_PLAYERS: 'You need at least two players.',
  GAME_NOT_ACTIVE: 'The game is not running.',
  NOT_CATCHER: 'Only catchers can tag.',
  ALREADY_IN_GAME: 'Exit your current room or finish the game before starting or joining another.',
  RATE_LIMITED: 'Too many requests. Wait a moment.',
};

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const API_REQUEST_TIMEOUT_MS = 10_000;

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, API_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? undefined : { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const data = await response.json() as T & { error?: string; message?: string };
    if (!response.ok) {
      const code = data?.error ?? 'SERVER_ERROR';
      throw new ApiError(code, data?.message ?? MESSAGES[code] ?? 'Something went wrong.', response.status);
    }
    if (!data) throw new ApiError('SERVER_ERROR', 'Empty response. Retrying…', response.status);
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) throw new ApiError('TIMEOUT', 'Connection timed out. Retrying…', 0);
    if (signal?.aborted) throw new ApiError('CANCELLED', 'Request cancelled.', 0);
    throw new ApiError('NETWORK', 'Connection lost. Retrying…', 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

type StateResponse = { state: GameState };

export const api = {
  getState: () => request<{ state: GameState | null }>('GET', '/api/game'),
  createGame: (name: string) => request<StateResponse>('POST', '/api/games', { name }),
  joinGame: (code: string, name: string) => request<StateResponse>('POST', '/api/games/join', { code, name }),
  leaveGame: () => request<{ state: null }>('POST', '/api/game/leave'),
  startGame: () => request<StateResponse>('POST', '/api/game/start'),
  endGame: () => request<StateResponse>('POST', '/api/game/end'),
  updateLocation: (lat: number, lng: number, accuracy: number | null, capturedAt: number, signal?: AbortSignal) =>
    request<LocationAck>('PUT', '/api/game/location', { lat, lng, accuracy, captured_at: capturedAt }, signal),
  getRadar: (signal?: AbortSignal) => request<RadarResponse>('GET', '/api/game/radar', undefined, signal),
  getMap: (signal?: AbortSignal) => request<MapResponse>('GET', '/api/game/map', undefined, signal),
  tag: (input: { payload: string } | { code: string }) =>
    request<StateResponse & { result: TagResult }>('POST', '/api/game/tag', input),
};

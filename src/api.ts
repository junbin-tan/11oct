import type { GameState, RadarResponse, TagResult } from './types';

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
  ALREADY_IN_GAME: 'Finish your current game before starting or joining another.',
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

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? undefined : { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError('NETWORK', 'Connection lost. Retrying…', 0);
  }

  const data = (await response.json().catch(() => null)) as
    | (T & { error?: string; message?: string })
    | null;
  if (!response.ok) {
    const code = data?.error ?? 'SERVER_ERROR';
    throw new ApiError(code, data?.message ?? MESSAGES[code] ?? 'Something went wrong.', response.status);
  }
  return data as T;
}

type StateResponse = { state: GameState };

export const api = {
  getState: () => request<{ state: GameState | null }>('GET', '/api/game'),
  createGame: (name: string) => request<StateResponse>('POST', '/api/games', { name }),
  joinGame: (code: string, name: string) => request<StateResponse>('POST', '/api/games/join', { code, name }),
  startGame: () => request<StateResponse>('POST', '/api/game/start'),
  endGame: () => request<StateResponse>('POST', '/api/game/end'),
  updateLocation: (lat: number, lng: number, accuracy: number | null) =>
    request<{ accepted: boolean }>('PUT', '/api/game/location', { lat, lng, accuracy }),
  getRadar: () => request<RadarResponse>('GET', '/api/game/radar'),
  tag: (input: { payload: string } | { code: string }) =>
    request<StateResponse & { result: TagResult }>('POST', '/api/game/tag', input),
};

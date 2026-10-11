export type ErrorCode =
  | 'INVALID_INPUT'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_STARTED'
  | 'ROOM_ENDED'
  | 'ROOM_FULL'
  | 'NOT_IN_ROOM'
  | 'HOST_ONLY'
  | 'NOT_ENOUGH_PLAYERS'
  | 'GAME_NOT_ACTIVE'
  | 'NOT_CATCHER'
  | 'INVALID_TAG';

const STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  ROOM_NOT_FOUND: 404,
  ROOM_STARTED: 409,
  ROOM_ENDED: 409,
  ROOM_FULL: 409,
  NOT_IN_ROOM: 401,
  HOST_ONLY: 403,
  NOT_ENOUGH_PLAYERS: 409,
  GAME_NOT_ACTIVE: 409,
  NOT_CATCHER: 403,
  INVALID_TAG: 400,
};

export class GameError extends Error {
  readonly statusCode: number;

  constructor(readonly code: ErrorCode, message?: string) {
    super(message ?? code);
    this.statusCode = STATUS[code];
  }
}

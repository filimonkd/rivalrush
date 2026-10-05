/**
 * Stable application error codes. Clients branch on `code`; `message` is for humans.
 * Never put secrets, raw tokens or internal state into an error.
 */
export const ERROR_CODES = [
  'UNAUTHORIZED',
  'INVALID_TELEGRAM_AUTH',
  'STALE_AUTH',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'ROOM_NOT_FOUND',
  'ROOM_EXPIRED',
  'ROOM_CLOSED',
  'ROOM_FULL',
  'ALREADY_IN_ROOM',
  'NOT_ROOM_MEMBER',
  'NOT_HOST',
  'NOT_READY',
  'GAME_NOT_AVAILABLE',
  'GAME_ALREADY_STARTED',
  'GAME_NOT_STARTED',
  'NOT_YOUR_TURN',
  'INVALID_ACTION',
  'INVALID_SECRET',
  'SECRET_ALREADY_SET',
  'INVALID_GUESS',
  'DUPLICATE_GUESS',
  'DUPLICATE_ACTION',
  'STALE_GAME_VERSION',
  'GAME_FINISHED',
  'PLAYER_FORFEITED',
  'REMATCH_UNAVAILABLE',
  'RATE_LIMITED',
  'RECONNECT_REQUIRED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AppErrorPayload {
  code: ErrorCode;
  message: string;
  /** Safe, machine-readable extra information (never secrets). */
  details?: Record<string, unknown>;
}

export const DEFAULT_ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHORIZED: 'Please sign in again.',
  INVALID_TELEGRAM_AUTH: 'Could not verify your Telegram session. Reopen the app from the bot.',
  STALE_AUTH: 'Your Telegram session is too old. Reopen the app from the bot.',
  VALIDATION_ERROR: 'That request was not valid.',
  NOT_FOUND: 'Not found.',
  ROOM_NOT_FOUND: "Can't find this room.",
  ROOM_EXPIRED: 'This room has expired.',
  ROOM_CLOSED: "Can't join this room. It has closed.",
  ROOM_FULL: 'This room is already full.',
  ALREADY_IN_ROOM: 'You are already playing in another room.',
  NOT_ROOM_MEMBER: 'You are not in this room.',
  NOT_HOST: 'Only the host can do that.',
  NOT_READY: 'Waiting for every player to be ready.',
  GAME_NOT_AVAILABLE: 'That game is coming soon.',
  GAME_ALREADY_STARTED: 'The game has already started.',
  GAME_NOT_STARTED: 'The game has not started yet.',
  NOT_YOUR_TURN: "It's not your turn.",
  INVALID_ACTION: 'That move is not allowed right now.',
  INVALID_SECRET: 'That code is not valid.',
  SECRET_ALREADY_SET: 'Your code is already locked in.',
  INVALID_GUESS: 'That guess is not valid.',
  DUPLICATE_GUESS: 'You already tried that one.',
  DUPLICATE_ACTION: 'That action was already received.',
  STALE_GAME_VERSION: 'The game moved on. Here is the latest board.',
  GAME_FINISHED: 'This game is over.',
  PLAYER_FORFEITED: 'A player gave up.',
  REMATCH_UNAVAILABLE: 'A rematch is not possible right now.',
  RATE_LIMITED: 'Slow down a little.',
  RECONNECT_REQUIRED: 'Reconnecting… your game is safe.',
  INTERNAL_ERROR: 'Something went wrong on our side.',
};

export function errorPayload(
  code: ErrorCode,
  message?: string,
  details?: Record<string, unknown>,
): AppErrorPayload {
  const payload: AppErrorPayload = { code, message: message ?? DEFAULT_ERROR_MESSAGES[code] };
  if (details) payload.details = details;
  return payload;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

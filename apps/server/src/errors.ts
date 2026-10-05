import { errorPayload, type AppErrorPayload, type ErrorCode } from '@rivalrush/shared';

const HTTP_STATUS: Partial<Record<ErrorCode, number>> = {
  UNAUTHORIZED: 401,
  INVALID_TELEGRAM_AUTH: 401,
  STALE_AUTH: 401,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  ROOM_NOT_FOUND: 404,
  ROOM_EXPIRED: 410,
  ROOM_CLOSED: 410,
  ROOM_FULL: 409,
  ALREADY_IN_ROOM: 409,
  NOT_ROOM_MEMBER: 403,
  NOT_HOST: 403,
  NOT_READY: 409,
  GAME_NOT_AVAILABLE: 400,
  GAME_ALREADY_STARTED: 409,
  GAME_NOT_STARTED: 409,
  NOT_YOUR_TURN: 409,
  INVALID_ACTION: 400,
  INVALID_SECRET: 400,
  SECRET_ALREADY_SET: 409,
  INVALID_GUESS: 400,
  DUPLICATE_GUESS: 409,
  DUPLICATE_ACTION: 409,
  STALE_GAME_VERSION: 409,
  GAME_FINISHED: 409,
  REMATCH_UNAVAILABLE: 409,
  RATE_LIMITED: 429,
  RECONNECT_REQUIRED: 409,
  INTERNAL_ERROR: 500,
};

/** An expected, user-safe failure. Message and details must never contain secrets. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    const payload = errorPayload(code, message, details);
    super(payload.message);
    this.code = code;
    this.details = details;
  }

  static from(payload: AppErrorPayload): AppError {
    return new AppError(payload.code, payload.message, payload.details);
  }

  get status(): number {
    return HTTP_STATUS[this.code] ?? 400;
  }

  toPayload(): AppErrorPayload {
    return errorPayload(this.code, this.message, this.details);
  }
}

export function toErrorPayload(err: unknown): AppErrorPayload {
  if (err instanceof AppError) return err.toPayload();
  return errorPayload('INTERNAL_ERROR');
}

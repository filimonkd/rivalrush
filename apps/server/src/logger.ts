import { pino, type Logger } from 'pino';

/**
 * Structured JSON logs. Redaction is a safety net: callers must still never pass
 * secret codes, raw initData, tokens or guesses into log fields.
 */
export const REDACT_PATHS = [
  'token',
  '*.token',
  'authorization',
  '*.authorization',
  'req.headers.authorization',
  'initData',
  '*.initData',
  'botToken',
  '*.botToken',
  'jwtSecret',
  '*.jwtSecret',
  'secret',
  '*.secret',
  'guess',
  '*.guess',
  'inviteToken',
  '*.inviteToken',
  'mongoUri',
  '*.mongoUri',
];

export function createLogger(level: string, destination?: NodeJS.WritableStream): Logger {
  return pino(
    {
      level,
      base: { service: 'rivalrush-server' },
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination as pino.DestinationStream | undefined,
  );
}

/** Short, non-reversible label for an invite token in logs. */
export function tokenHint(token: string): string {
  return `${token.slice(0, 4)}…`;
}

import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors.js';

/**
 * Telegram Mini App launch-data validation ("Validating data received via the Mini App").
 *
 *   data_check_string = every received field except `hash`, as `key=value`,
 *                       sorted alphabetically by key, joined with "\n"
 *   secret_key        = HMAC_SHA256(key = "WebAppData", message = bot_token)
 *   hash              = hex(HMAC_SHA256(key = secret_key, message = data_check_string))
 *
 * Values are compared after URL-decoding, exactly as Telegram computes them. Fields such as
 * `signature` (used for third-party Ed25519 validation) stay in the check string.
 * initDataUnsafe on the client is never trusted; only this server-side check is.
 */

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface ValidatedInitData {
  user: TelegramUser;
  authDate: number;
  startParam: string | null;
  chatInstance: string | null;
  chatType: string | null;
}

export interface ValidateOptions {
  /** Max age of auth_date in seconds. */
  maxAgeSeconds: number;
  /** Current time in ms (injectable for tests). */
  now?: number;
  /** Allowed clock skew for auth_date in the future, in seconds. */
  futureSkewSeconds?: number;
}

export function telegramSecretKey(botToken: string): Buffer {
  return createHmac('sha256', 'WebAppData').update(botToken).digest();
}

export function computeInitDataHash(pairs: Array<[string, string]>, botToken: string): string {
  const dataCheckString = pairs
    .filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  return createHmac('sha256', telegramSecretKey(botToken)).update(dataCheckString).digest('hex');
}

const invalid = (why: string) => new AppError('INVALID_TELEGRAM_AUTH', undefined, { why });

export function validateInitData(
  raw: string,
  botToken: string,
  opts: ValidateOptions,
): ValidatedInitData {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 8192) throw invalid('malformed');
  const params = new URLSearchParams(raw);
  const pairs: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const [k, v] of params) {
    if (seen.has(k)) throw invalid('duplicate_field');
    seen.add(k);
    pairs.push([k, v]);
  }

  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) throw invalid('missing_hash');

  const expected = Buffer.from(computeInitDataHash(pairs, botToken), 'hex');
  const received = Buffer.from(hash, 'hex');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw invalid('bad_signature');
  }

  // Freshness is checked only after the signature, so attackers learn nothing from timing.
  const authDateRaw = params.get('auth_date');
  if (!authDateRaw || !/^\d{1,12}$/.test(authDateRaw)) throw invalid('bad_auth_date');
  const authDate = Number(authDateRaw);
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  if (authDate > nowSec + (opts.futureSkewSeconds ?? 60)) {
    throw new AppError('STALE_AUTH', undefined, { why: 'future' });
  }
  if (nowSec - authDate > opts.maxAgeSeconds) {
    throw new AppError('STALE_AUTH', undefined, { why: 'expired' });
  }

  const userRaw = params.get('user');
  if (!userRaw) throw invalid('missing_user');
  let user: unknown;
  try {
    user = JSON.parse(userRaw);
  } catch {
    throw invalid('bad_user');
  }
  if (!isTelegramUser(user)) throw invalid('bad_user');

  return {
    user,
    authDate,
    startParam: params.get('start_param'),
    chatInstance: params.get('chat_instance'),
    chatType: params.get('chat_type'),
  };
}

function isTelegramUser(u: unknown): u is TelegramUser {
  if (typeof u !== 'object' || u === null) return false;
  const o = u as Record<string, unknown>;
  const optStr = (k: string) => o[k] === undefined || typeof o[k] === 'string';
  return (
    typeof o.id === 'number' &&
    Number.isSafeInteger(o.id) &&
    o.id > 0 &&
    typeof o.first_name === 'string' &&
    optStr('last_name') &&
    optStr('username') &&
    optStr('language_code') &&
    optStr('photo_url') &&
    (o.is_premium === undefined || typeof o.is_premium === 'boolean')
  );
}

/** Builds signed launch data. Used by tests and the local signing helper only. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const pairs = Object.entries(fields);
  const hash = computeInitDataHash(pairs, botToken);
  const params = new URLSearchParams([...pairs, ['hash', hash]]);
  return params.toString();
}

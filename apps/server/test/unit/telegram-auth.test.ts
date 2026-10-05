import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signInitData, validateInitData } from '../../src/auth/telegramAuth.js';
import { AppError } from '../../src/errors.js';

const BOT = '123456:TEST-bot-token';
const NOW = 1_800_000_000_000;
const nowSec = Math.floor(NOW / 1000);
const user = {
  id: 42,
  first_name: 'Abebe',
  username: 'abebe',
  language_code: 'en',
  is_premium: true,
};

function fields(over: Record<string, string> = {}) {
  return {
    query_id: 'AAH',
    user: JSON.stringify(user),
    auth_date: String(nowSec - 10),
    signature: 'sig-not-checked-by-hmac',
    start_param: 'room_Ab3dEf7Hj9Kl2Mn4',
    ...over,
  };
}

function expectCode(fn: () => unknown, code: string, why?: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    if (why) expect((err as AppError).details?.why).toBe(why);
    return;
  }
  throw new Error('expected an error');
}

const opts = { maxAgeSeconds: 3600, now: NOW };

describe('validateInitData', () => {
  it('accepts valid launch data and extracts the user and start_param', () => {
    const v = validateInitData(signInitData(fields(), BOT), BOT, opts);
    expect(v.user).toMatchObject({ id: 42, first_name: 'Abebe', is_premium: true });
    expect(v.startParam).toBe('room_Ab3dEf7Hj9Kl2Mn4');
    expect(v.authDate).toBe(nowSec - 10);
  });

  it('matches an independent implementation of the documented algorithm', () => {
    // secret_key = HMAC_SHA256("WebAppData", bot_token); hash = HMAC_SHA256(secret_key, dcs)
    const f = fields();
    const dcs = Object.keys(f)
      .sort()
      .map((k) => `${k}=${f[k as keyof typeof f]}`)
      .join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(BOT).digest();
    const hash = createHmac('sha256', secret).update(dcs).digest('hex');
    const raw = new URLSearchParams({ ...f, hash }).toString();
    expect(validateInitData(raw, BOT, opts).user.id).toBe(42);
  });

  it('rejects a tampered field (invalid hash)', () => {
    const raw = signInitData(fields(), BOT).replace('Abebe', 'Mallory');
    expectCode(() => validateInitData(raw, BOT, opts), 'INVALID_TELEGRAM_AUTH', 'bad_signature');
  });

  it('rejects data signed with another bot token', () => {
    expectCode(
      () => validateInitData(signInitData(fields(), '999:OTHER'), BOT, opts),
      'INVALID_TELEGRAM_AUTH',
      'bad_signature',
    );
  });

  it('rejects stale data', () => {
    const raw = signInitData(fields({ auth_date: String(nowSec - 3601) }), BOT);
    expectCode(() => validateInitData(raw, BOT, opts), 'STALE_AUTH', 'expired');
  });

  it('rejects data dated in the future', () => {
    const raw = signInitData(fields({ auth_date: String(nowSec + 600) }), BOT);
    expectCode(() => validateInitData(raw, BOT, opts), 'STALE_AUTH', 'future');
  });

  it('rejects malformed input', () => {
    expectCode(() => validateInitData('', BOT, opts), 'INVALID_TELEGRAM_AUTH');
    expectCode(
      () => validateInitData('user=x', BOT, opts),
      'INVALID_TELEGRAM_AUTH',
      'missing_hash',
    );
    expectCode(
      () => validateInitData('hash=zz', BOT, opts),
      'INVALID_TELEGRAM_AUTH',
      'missing_hash',
    );
    const noUser = signInitData({ auth_date: String(nowSec) }, BOT);
    expectCode(() => validateInitData(noUser, BOT, opts), 'INVALID_TELEGRAM_AUTH', 'missing_user');
    const badUser = signInitData(fields({ user: '{"id":"42"}' }), BOT);
    expectCode(() => validateInitData(badUser, BOT, opts), 'INVALID_TELEGRAM_AUTH', 'bad_user');
    const badDate = signInitData(fields({ auth_date: 'yesterday' }), BOT);
    expectCode(
      () => validateInitData(badDate, BOT, opts),
      'INVALID_TELEGRAM_AUTH',
      'bad_auth_date',
    );
  });

  it('rejects duplicated fields (parameter smuggling)', () => {
    const raw = `${signInitData(fields(), BOT)}&user=${encodeURIComponent(JSON.stringify({ id: 1, first_name: 'X' }))}`;
    expectCode(() => validateInitData(raw, BOT, opts), 'INVALID_TELEGRAM_AUTH', 'duplicate_field');
  });

  it('never echoes the payload in the error', () => {
    try {
      validateInitData(signInitData(fields(), '999:OTHER'), BOT, opts);
    } catch (err) {
      expect(JSON.stringify((err as AppError).toPayload())).not.toContain('Abebe');
    }
  });
});

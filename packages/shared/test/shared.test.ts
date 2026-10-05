import { describe, expect, it } from 'vitest';
import {
  buildInviteLink,
  checkCode,
  ctcActionSchema,
  ctcSettingsSchema,
  DEFAULT_CTC_SETTINGS,
  parseInviteStartParam,
} from '../src/index.js';

describe('invite start_param', () => {
  it('round-trips a token through the Telegram startapp link', () => {
    const token = 'Ab3dEf7Hj9Kl2Mn4';
    expect(buildInviteLink('RivalRushBot', token)).toBe(
      'https://t.me/RivalRushBot?startapp=room_Ab3dEf7Hj9Kl2Mn4',
    );
    expect(parseInviteStartParam(`room_${token}`)).toBe(token);
  });

  it('rejects anything that is not an opaque room token', () => {
    expect(parseInviteStartParam(undefined)).toBeNull();
    expect(parseInviteStartParam('room_short')).toBeNull();
    expect(parseInviteStartParam('other_Ab3dEf7Hj9Kl2Mn4')).toBeNull();
    expect(parseInviteStartParam('room_Ab3dEf7Hj9Kl2Mn4<script>')).toBeNull();
  });
});

describe('Crack the Code shared validation', () => {
  it('applies defaults and enforces ranges', () => {
    expect(ctcSettingsSchema.parse({})).toEqual(DEFAULT_CTC_SETTINGS);
    expect(ctcSettingsSchema.safeParse({ codeLength: 6 }).success).toBe(false);
    expect(ctcSettingsSchema.safeParse({ turnSeconds: 29 }).success).toBe(false);
    expect(ctcSettingsSchema.safeParse({ maxGuesses: 13 }).success).toBe(false);
    expect(ctcSettingsSchema.safeParse({ hacked: true }).success).toBe(false);
  });

  it('checks code rules', () => {
    expect(checkCode('0123', 4)).toBe('ok');
    expect(checkCode('123', 4)).toBe('length');
    expect(checkCode('1123', 4)).toBe('repeat');
    expect(checkCode('12a4', 4)).toBe('digits');
  });

  it('rejects action shapes with extra fields (e.g. a fake winner)', () => {
    expect(ctcActionSchema.safeParse({ type: 'GUESS', guess: '1234' }).success).toBe(true);
    expect(ctcActionSchema.safeParse({ type: 'GUESS', guess: '1234', bulls: 4 }).success).toBe(
      false,
    );
    expect(ctcActionSchema.safeParse({ type: 'WIN' }).success).toBe(false);
  });
});

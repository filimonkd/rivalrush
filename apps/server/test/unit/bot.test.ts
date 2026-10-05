import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { TelegramBot } from '../../src/bot/bot.js';

const bot = new TelegramBot({
  token: '1:x',
  webAppUrl: 'https://rivalrush.app',
  logger: pino({ level: 'silent' }),
});

describe('TelegramBot replies', () => {
  it('/start offers a Play button that opens the Mini App', () => {
    const r = bot.replyFor({ chat: { id: 7 }, text: '/start', from: { first_name: 'Abebe' } })!;
    expect(r.chat_id).toBe(7);
    expect(r.text).toContain('Abebe');
    expect(r.reply_markup).toEqual({
      inline_keyboard: [[{ text: 'Play', web_app: { url: 'https://rivalrush.app' } }]],
    });
  });

  it('/start room_<token> deep-links into the join screen', () => {
    const r = bot.replyFor({ chat: { id: 7 }, text: '/start room_Ab3dEf7Hj9Kl2Mn4' })!;
    expect(JSON.stringify(r.reply_markup)).toContain('https://rivalrush.app/join/Ab3dEf7Hj9Kl2Mn4');
  });

  it('ignores junk start payloads', () => {
    const r = bot.replyFor({ chat: { id: 7 }, text: '/start room_<script>' })!;
    expect(JSON.stringify(r.reply_markup)).not.toContain('join');
  });

  it('/help explains the rules; other text is ignored', () => {
    expect(bot.replyFor({ chat: { id: 7 }, text: '/help@RivalRushBot' })?.text).toContain('Bull');
    expect(bot.replyFor({ chat: { id: 7 }, text: 'hello' })).toBeNull();
  });

  it('surfaces Telegram API errors without the token-bearing URL', async () => {
    const failing = new TelegramBot({
      token: '1:SECRET',
      webAppUrl: 'https://rivalrush.app',
      logger: pino({ level: 'silent' }),
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), {
          status: 401,
        })) as typeof fetch,
    });
    await expect(failing.call('getMe')).rejects.toThrow(/getMe failed: Unauthorized/);
    await expect(failing.call('getMe')).rejects.not.toThrow(/SECRET/);
  });
});

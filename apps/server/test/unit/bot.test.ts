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

describe('webhook mode', () => {
  it('derives a stable hex secret Telegram accepts, and checks it in constant time', async () => {
    const { webhookSecret, isValidWebhookSecret } = await import('../../src/bot/bot.js');
    const s = webhookSecret('123:abc');
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(webhookSecret('123:abc')).toBe(s);
    expect(webhookSecret('999:other')).not.toBe(s);
    expect(isValidWebhookSecret(s, '123:abc')).toBe(true);
    expect(isValidWebhookSecret(s, '999:other')).toBe(false);
    expect(isValidWebhookSecret(undefined, '123:abc')).toBe(false);
    expect(isValidWebhookSecret('short', '123:abc')).toBe(false);
  });

  it('registers the webhook URL with the secret token, then sets commands and menu button', async () => {
    const { webhookSecret } = await import('../../src/bot/bot.js');
    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
    const recording = new TelegramBot({
      token: '1:x',
      webAppUrl: 'https://rivalrush.app',
      logger: pino({ level: 'silent' }),
      fetchImpl: (async (url: string, init: { body: string }) => {
        calls.push({ method: String(url).split('/').pop()!, body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ ok: true, result: true }));
      }) as unknown as typeof fetch,
    });
    await recording.startWebhook('https://api.rivalrush.app/');
    expect(calls.map((c) => c.method)).toEqual([
      'setWebhook',
      'setMyCommands',
      'setChatMenuButton',
    ]);
    expect(calls[0]!.body).toMatchObject({
      url: 'https://api.rivalrush.app/telegram/webhook',
      secret_token: webhookSecret('1:x'),
      allowed_updates: ['message'],
    });
    await recording.handleUpdate({ update_id: 1, message: { chat: { id: 5 }, text: '/start' } });
    expect(calls.at(-1)!.method).toBe('sendMessage');
    await recording.handleUpdate({ update_id: 2, message: { chat: { id: 5 }, text: 'hi' } });
    expect(calls).toHaveLength(4);
  });
});

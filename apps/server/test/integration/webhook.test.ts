import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TelegramBot, webhookSecret } from '../../src/bot/bot.js';
import { BOT_TOKEN, startTestServer, type TestEnv } from '../helpers/integration.js';

const sent: Array<Record<string, unknown>> = [];
const bot = new TelegramBot({
  token: BOT_TOKEN,
  webAppUrl: 'https://rivalrush.app',
  logger: pino({ level: 'silent' }),
  fetchImpl: (async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, result: true }));
  }) as unknown as typeof fetch,
});

let env: TestEnv;
beforeAll(async () => {
  env = await startTestServer({}, { bot });
});
afterAll(async () => {
  await env?.stop();
});

const update = {
  update_id: 10,
  message: { chat: { id: 42 }, text: '/start', from: { first_name: 'Abebe' } },
};

describe('POST /telegram/webhook', () => {
  it('rejects requests without the secret token header', async () => {
    await env.http().post('/telegram/webhook').send(update).expect(401);
    await env
      .http()
      .post('/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', 'nope')
      .send(update)
      .expect(401);
    expect(sent).toHaveLength(0);
  });

  it('answers /start when Telegram calls with the right secret', async () => {
    await env
      .http()
      .post('/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', webhookSecret(BOT_TOKEN))
      .send(update)
      .expect(200);
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ chat_id: 42 });
  });
});

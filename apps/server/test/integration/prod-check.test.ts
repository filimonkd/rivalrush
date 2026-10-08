import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TelegramBot } from '../../src/bot/bot.js';
import { formatProdChecks, runProdChecks } from '../../src/ops/prodCheck.js';
import { BOT_TOKEN, startTestServer, type TestEnv } from '../helpers/integration.js';

/**
 * The production check against a real server configured like production in the ways it
 * inspects (dev login off, the bot's webhook on, one allowed web origin) and a tiny stand-in
 * for the Vercel site whose bundle points at that server.
 */
let env: TestEnv;
let web: Server;
let webUrl = '';
let apiUrl = '';

beforeAll(async () => {
  web = createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-abc.js"></script></head><body><div id="root"></div></body></html>',
      );
    } else if (req.url === '/assets/index-abc.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(`const API="${apiUrl}";console.log(API);`);
    } else res.writeHead(404).end();
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
  webUrl = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;
  const bot = new TelegramBot({
    token: BOT_TOKEN,
    webAppUrl: webUrl,
    logger: pino({ level: 'silent' }),
    fetchImpl: (async () => new Response('{"ok":true,"result":true}')) as unknown as typeof fetch,
  });
  env = await startTestServer({ DEV_LOGIN_ENABLED: 'false', CLIENT_ORIGINS: webUrl }, { bot });
  apiUrl = env.url;
});
afterAll(async () => {
  await env?.stop();
  await new Promise((r) => web?.close(r));
});

describe('prod check against a correctly configured deployment', () => {
  it('passes every check', async () => {
    const results = await runProdChecks({ api: apiUrl, web: `${webUrl}/`, timeoutMs: 5000 });
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results.map((r) => r.name)).toEqual([
      'API health',
      'Security headers',
      'CORS allows the web app',
      'CORS refuses other sites',
      'Dev login is off',
      'API needs sign-in',
      'Telegram webhook route',
      'Socket.IO',
      'Web app',
      'Web app talks to this API',
    ]);
    expect(formatProdChecks(results)).toContain('All checks passed.');
  });

  it('flags a deploy that is not the expected commit', async () => {
    const results = await runProdChecks({
      api: apiUrl,
      web: webUrl,
      commit: 'abc1234def',
      timeoutMs: 5000,
    });
    // Tests run without RENDER_GIT_COMMIT, so the server reports its package version.
    expect(results.find((r) => r.name === 'Deployed commit')).toMatchObject({
      ok: false,
      detail: 'running 0.1.0, expected abc1234 (deploy the latest commit on Render)',
    });
  });
});

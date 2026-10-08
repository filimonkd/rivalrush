import { describe, expect, it } from 'vitest';
import { formatProdChecks, runProdChecks, type CheckResult } from '../../src/ops/prodCheck.js';

const API = 'https://api.example';
const WEB = 'https://app.example';
const TOKEN = '7000000001:SECRET_bot_token_value';

interface Fake {
  health?: { status: number; body: unknown };
  allowOrigins?: string[];
  devLogin?: number;
  me?: number;
  webhook?: number;
  bundle?: string;
  headers?: Record<string, string>;
  webhookInfo?: unknown;
  throwOn?: string;
}

function fakeFetch(o: Fake) {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (o.throwOn && url.includes(o.throwOn)) throw new Error(`connect ECONNREFUSED for ${url}`);
    const method = init?.method ?? 'GET';
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers });
    if (url === `${API}/health`)
      return json(
        o.health?.status ?? 200,
        o.health?.body ?? { status: 'ok', database: 'up', version: 'abc1234' },
        o.headers ?? {
          'x-content-type-options': 'nosniff',
          'strict-transport-security': 'max-age=1',
        },
      );
    if (url === `${API}/api/me` && method === 'OPTIONS') {
      const origin = (init?.headers as Record<string, string>).Origin!;
      const allowed = (o.allowOrigins ?? [WEB]).includes(origin) || o.allowOrigins?.includes('*');
      return new Response(null, {
        status: 204,
        headers: allowed ? { 'access-control-allow-origin': origin } : {},
      });
    }
    if (url === `${API}/api/me`) return json(o.me ?? 401, {});
    if (url === `${API}/api/auth/dev`) return json(o.devLogin ?? 404, {});
    if (url === `${API}/telegram/webhook`) return json(o.webhook ?? 401, {});
    if (url === `${WEB}/`)
      return new Response(
        '<div id="root"></div><script type="module" src="/assets/a.js"></script>',
      );
    if (url === `${WEB}/assets/a.js`) return new Response(o.bundle ?? `fetch("${API}/api/me")`);
    if (url.startsWith('https://api.telegram.org/'))
      return json(200, o.webhookInfo ?? { ok: true, result: { url: `${API}/telegram/webhook` } });
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

const run = (o: Fake, extra: Partial<Parameters<typeof runProdChecks>[0]> = {}) =>
  runProdChecks({
    api: `${API}/`,
    web: WEB,
    fetchImpl: fakeFetch(o),
    socketProbe: async () => 'UNAUTHORIZED',
    ...extra,
  });
const failed = (rs: CheckResult[]) => rs.filter((r) => !r.ok).map((r) => `${r.name}: ${r.detail}`);

describe('prod check', () => {
  it('passes a healthy deployment, including the commit and the webhook', async () => {
    const rs = await run({}, { commit: 'abc1234ffff', botToken: TOKEN });
    expect(failed(rs)).toEqual([]);
    expect(rs.map((r) => r.name)).toContain('Telegram getWebhookInfo');
  });

  it('names what to fix for each misconfiguration', async () => {
    const rs = await run(
      {
        health: { status: 503, body: { status: 'degraded', database: 'down', version: 'old0000' } },
        allowOrigins: ['*'],
        devLogin: 200,
        me: 200,
        webhook: 404,
        bundle: 'fetch("http://localhost:4000/api/me")',
        headers: { 'x-powered-by': 'Express' },
      },
      { commit: 'abc1234', socketProbe: async () => 'no answer' },
    );
    expect(failed(rs)).toEqual([
      'API health: HTTP 503 · status degraded · database down · version old0000',
      'Deployed commit: running old0000, expected abc1234 (deploy the latest commit on Render)',
      'Security headers: no X-Content-Type-Options, X-Powered-By is exposed, no Strict-Transport-Security',
      'CORS refuses other sites: allowed https://not-rivalrush.example: CLIENT_ORIGINS is too wide',
      'Dev login is off: HTTP 200: anyone can sign in as anyone. Set DEV_LOGIN_ENABLED=false now',
      'API needs sign-in: HTTP 200 without a token',
      'Telegram webhook route: not registered: the bot is off (BOT_TOKEN / WEBAPP_URL)',
      'Socket.IO: got: no answer',
      `Web app talks to this API: the bundle does not mention ${API}: set VITE_API_URL on Vercel and redeploy`,
    ]);
    expect(formatProdChecks(rs)).toContain('9 check(s) failed.');
  });

  it('says which origin to add when CORS refuses the web app', async () => {
    const rs = await run({ allowOrigins: ['https://other.example'] });
    expect(failed(rs)).toEqual([
      `CORS allows the web app: got nothing: add ${WEB} to CLIENT_ORIGINS on Render`,
    ]);
  });

  it('checks where Telegram sends updates, and warns about recent webhook errors', async () => {
    const wrong = await run(
      { webhookInfo: { ok: true, result: { url: 'https://old.example/telegram/webhook' } } },
      { botToken: TOKEN },
    );
    expect(failed(wrong)).toEqual([
      `Telegram getWebhookInfo: webhook is https://old.example/telegram/webhook, expected ${API}/telegram/webhook`,
    ]);
    const erroring = await run(
      {
        webhookInfo: {
          ok: true,
          result: {
            url: `${API}/telegram/webhook`,
            pending_update_count: 3,
            last_error_date: Math.floor(Date.now() / 1000) - 60,
            last_error_message: 'Wrong response from the webhook: 502 Bad Gateway',
          },
        },
      },
      { botToken: TOKEN },
    );
    const info = erroring.find((r) => r.name === 'Telegram getWebhookInfo')!;
    expect(info).toMatchObject({ ok: true, warn: true });
    expect(info.detail).toMatch(/3 pending · last error .*502 Bad Gateway/);
    expect(formatProdChecks(erroring)).toMatch(/⚠️ +Telegram getWebhookInfo/);
  });

  it('never prints the bot token, even when a request to Telegram fails', async () => {
    const rs = await run({ throwOn: 'api.telegram.org' }, { botToken: TOKEN });
    const out = formatProdChecks(rs);
    expect(out).toContain('Telegram getWebhookInfo');
    expect(out).toContain('<token>');
    expect(out).not.toContain(TOKEN);
  });

  it('reports an unreachable API instead of crashing', async () => {
    const rs = await run({ throwOn: API });
    expect(rs.find((r) => r.name === 'API health')).toMatchObject({
      ok: false,
      detail: expect.stringContaining('request failed: connect ECONNREFUSED'),
    });
  });
});

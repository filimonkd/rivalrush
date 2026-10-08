import { io } from 'socket.io-client';

/**
 * Read-only checks of a deployed RivalRush (API on Render, web app on Vercel): the same things the
 * runbook's health check and the production checklist ask a person to look at, in one command.
 * Nothing here signs in, creates rooms or writes data; no token or secret is ever printed.
 */

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  /** A warning does not fail the run. */
  warn?: boolean;
}

export interface ProdCheckOptions {
  /** API base URL, e.g. https://rivalrush-api.onrender.com */
  api: string;
  /** Web app URL, e.g. https://rivalrush.vercel.app */
  web: string;
  /** Expected deployed commit (7+ characters); skipped when absent. */
  commit?: string;
  /** Bot token for Telegram's getWebhookInfo; skipped when absent. Never printed. */
  botToken?: string;
  fetchImpl?: typeof fetch;
  /** Socket.IO probe; injectable for tests. Resolves with the connect_error message. */
  socketProbe?: (api: string) => Promise<string>;
  timeoutMs?: number;
}

const NOT_OURS = 'https://not-rivalrush.example';

const trimSlash = (u: string) => u.replace(/\/+$/, '');

function probeSocket(api: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const s = io(api, { transports: ['websocket'], reconnection: false, timeout: timeoutMs });
    const timer = setTimeout(() => {
      s.close();
      resolve('no answer');
    }, timeoutMs);
    s.on('connect', () => {
      clearTimeout(timer);
      s.close();
      resolve('connected without a token');
    });
    s.on('connect_error', (err) => {
      clearTimeout(timer);
      s.close();
      resolve(err.message);
    });
  });
}

export async function runProdChecks(o: ProdCheckOptions): Promise<CheckResult[]> {
  const api = trimSlash(o.api);
  const web = trimSlash(o.web);
  const webOrigin = new URL(web).origin;
  const timeoutMs = o.timeoutMs ?? 15_000;
  const f = o.fetchImpl ?? fetch;
  const get = (url: string, init: RequestInit = {}) =>
    f(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
  const results: CheckResult[] = [];
  // Belt and braces: the bot token must never reach the output, even inside an error.
  const redact = (text: string) => (o.botToken ? text.split(o.botToken).join('<token>') : text);
  const check = async (name: string, fn: () => Promise<Omit<CheckResult, 'name'>>) => {
    try {
      const r = await fn();
      results.push({ name, ...r, detail: redact(r.detail) });
    } catch (err) {
      results.push({
        name,
        ok: false,
        detail: redact(`request failed: ${(err as Error).message}`),
      });
    }
  };

  let version: string | null = null;
  await check('API health', async () => {
    const res = await get(`${api}/health`);
    const body = (await res.json().catch(() => null)) as {
      status?: string;
      database?: string;
      version?: string;
    } | null;
    version = body?.version ?? null;
    const ok = res.status === 200 && body?.status === 'ok' && body.database === 'up';
    return {
      ok,
      detail: `HTTP ${res.status} · status ${body?.status ?? '?'} · database ${body?.database ?? '?'} · version ${version ?? '?'}`,
    };
  });

  if (o.commit) {
    const want = o.commit.slice(0, 7);
    results.push({
      name: 'Deployed commit',
      ok: version === want,
      detail:
        version === want
          ? `running ${want}`
          : `running ${version ?? '?'}, expected ${want} (deploy the latest commit on Render)`,
    });
  }

  await check('Security headers', async () => {
    const res = await get(`${api}/health`);
    const problems: string[] = [];
    if (res.headers.get('x-content-type-options') !== 'nosniff')
      problems.push('no X-Content-Type-Options');
    if (res.headers.get('x-powered-by')) problems.push('X-Powered-By is exposed');
    if (api.startsWith('https:') && !res.headers.get('strict-transport-security'))
      problems.push('no Strict-Transport-Security');
    return { ok: problems.length === 0, detail: problems.join(', ') || 'helmet headers present' };
  });

  const preflight = (origin: string) =>
    get(`${api}/api/me`, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
    });
  await check('CORS allows the web app', async () => {
    const allowed = (await preflight(webOrigin)).headers.get('access-control-allow-origin');
    return {
      ok: allowed === webOrigin,
      detail:
        allowed === webOrigin
          ? webOrigin
          : `got ${allowed ?? 'nothing'}: add ${webOrigin} to CLIENT_ORIGINS on Render`,
    };
  });
  await check('CORS refuses other sites', async () => {
    const allowed = (await preflight(NOT_OURS)).headers.get('access-control-allow-origin');
    return {
      ok: !allowed,
      detail: allowed ? `allowed ${allowed}: CLIENT_ORIGINS is too wide` : 'refused',
    };
  });

  await check('Dev login is off', async () => {
    const res = await get(`${api}/api/auth/dev`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'prod-check' }),
    });
    return {
      ok: res.status === 404,
      detail:
        res.status === 404
          ? 'not available'
          : `HTTP ${res.status}: anyone can sign in as anyone. Set DEV_LOGIN_ENABLED=false now`,
    };
  });

  await check('API needs sign-in', async () => {
    const res = await get(`${api}/api/me`);
    return { ok: res.status === 401, detail: `HTTP ${res.status} without a token` };
  });

  await check('Telegram webhook route', async () => {
    const res = await get(`${api}/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const detail =
      res.status === 401
        ? 'registered, refuses calls without the secret'
        : res.status === 404
          ? 'not registered: the bot is off (BOT_TOKEN / WEBAPP_URL)'
          : `HTTP ${res.status}`;
    return { ok: res.status === 401, detail };
  });

  await check('Socket.IO', async () => {
    const msg = await (o.socketProbe ?? ((a) => probeSocket(a, timeoutMs)))(api);
    return {
      ok: msg === 'UNAUTHORIZED',
      detail:
        msg === 'UNAUTHORIZED' ? 'reachable, refuses connections without a token' : `got: ${msg}`,
    };
  });

  let html = '';
  await check('Web app', async () => {
    const res = await get(`${web}/`);
    html = await res.text();
    const ok = res.status === 200 && html.includes('id="root"');
    return { ok, detail: `HTTP ${res.status}${ok ? '' : ' (not the RivalRush app?)'}` };
  });

  await check('Web app talks to this API', async () => {
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1]!);
    if (scripts.length === 0) return { ok: false, detail: 'no script found in the page' };
    for (const src of scripts) {
      const js = await (await get(new URL(src, `${web}/`).toString())).text();
      if (js.includes(api)) return { ok: true, detail: `bundle uses ${api}` };
    }
    return {
      ok: false,
      detail: `the bundle does not mention ${api}: set VITE_API_URL on Vercel and redeploy`,
    };
  });

  if (o.botToken) {
    await check('Telegram getWebhookInfo', async () => {
      const res = await get(`https://api.telegram.org/bot${o.botToken}/getWebhookInfo`);
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        result?: {
          url?: string;
          pending_update_count?: number;
          last_error_date?: number;
          last_error_message?: string;
        };
      } | null;
      if (!body?.ok) return { ok: false, detail: `HTTP ${res.status}: check the bot token` };
      const r = body.result ?? {};
      const want = `${api}/telegram/webhook`;
      if (r.url !== want)
        return { ok: false, detail: `webhook is ${r.url || 'unset'}, expected ${want}` };
      const recentError =
        r.last_error_date && Date.now() / 1000 - r.last_error_date < 24 * 3600
          ? ` · last error ${new Date(r.last_error_date * 1000).toISOString()}: ${r.last_error_message ?? ''}`
          : '';
      return {
        ok: true,
        warn: recentError !== '' || (r.pending_update_count ?? 0) > 0,
        detail: `${want} · ${r.pending_update_count ?? 0} pending${recentError}`,
      };
    });
  }

  return results;
}

export function formatProdChecks(results: CheckResult[]): string {
  const width = Math.max(...results.map((r) => r.name.length));
  const lines = results.map(
    (r) => `${r.ok ? (r.warn ? '⚠️ ' : '✅') : '❌'} ${r.name.padEnd(width)}  ${r.detail}`,
  );
  const failed = results.filter((r) => !r.ok).length;
  lines.push('', failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`);
  return lines.join('\n') + '\n';
}

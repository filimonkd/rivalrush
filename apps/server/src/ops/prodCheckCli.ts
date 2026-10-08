import { parseArgs } from 'node:util';
import { formatProdChecks, runProdChecks } from './prodCheck.js';

/**
 * Checks a deployed RivalRush from your own computer (read-only):
 *
 *   npm run prod:check -w @rivalrush/server -- --api https://<render>.onrender.com \
 *     --web https://<vercel-domain> [--commit <sha>]
 *
 * With BOT_TOKEN set in the environment it also asks Telegram where the webhook points. The
 * token is only sent to api.telegram.org and never printed.
 */
const USAGE =
  'Usage: npm run prod:check -w @rivalrush/server -- --api <API URL> --web <web app URL> ' +
  '[--commit <sha>]\n';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      api: { type: 'string' },
      web: { type: 'string' },
      commit: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help || !values.api || !values.web) {
    process.stderr.write(USAGE);
    return values.help ? 0 : 2;
  }
  for (const u of [values.api, values.web]) {
    if (!/^https?:\/\/[^/]+/.test(u)) {
      process.stderr.write(`Not a URL: ${u}\n${USAGE}`);
      return 2;
    }
  }
  const results = await runProdChecks({
    api: values.api,
    web: values.web,
    ...(values.commit ? { commit: values.commit } : {}),
    ...(process.env.BOT_TOKEN ? { botToken: process.env.BOT_TOKEN } : {}),
  });
  process.stdout.write(formatProdChecks(results));
  return results.every((r) => r.ok) ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    const token = process.env.BOT_TOKEN;
    let msg = err instanceof Error ? err.message : String(err);
    if (token) msg = msg.split(token).join('<token>');
    process.stderr.write(`prod check failed: ${msg}\n`);
    process.exit(1);
  },
);

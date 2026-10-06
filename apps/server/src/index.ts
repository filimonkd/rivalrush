import { TelegramBot } from './bot/bot.js';
import { ConfigError, loadConfig } from './config/env.js';
import { connectDatabase } from './db/connection.js';
import { createLogger } from './logger.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err instanceof ConfigError ? err.message : err);
    process.exit(1);
  }
  const logger = createLogger(config.logLevel);
  logger.info(
    {
      event: 'boot',
      env: config.nodeEnv,
      devLogin: config.devLoginEnabled,
      origins: config.clientOrigins,
    },
    'starting RivalRush server',
  );

  if (config.defuserEnabled) {
    logger.warn(
      { event: 'defuser.enabled' },
      'Defuser plug-in is registered (dev/test only; no UI, never advertised)',
    );
  }
  if (config.defuserFixedSeed) {
    // Never the value: it would make every Defuser game predictable. (Config already refuses
    // this in production.)
    logger.warn({ event: 'defuser.fixed_seed' }, 'Defuser fixed seed is active (test only)');
  }

  const db = await connectDatabase({
    uri: config.mongoUri,
    dbName: config.mongoDbName,
    allowInMemory: config.nodeEnv === 'development',
    logger,
  });
  // Bot first: in webhook mode the HTTP app serves its endpoint.
  let bot: TelegramBot | null = null;
  if (config.botMode !== 'off') {
    if (config.botToken && config.webAppUrl && (config.botMode === 'polling' || config.publicUrl)) {
      bot = new TelegramBot({ token: config.botToken, webAppUrl: config.webAppUrl, logger });
    } else {
      logger.warn(
        { mode: config.botMode },
        'bot enabled but BOT_TOKEN, WEBAPP_URL or PUBLIC_URL is missing; bot not started',
      );
    }
  }
  const server = buildServer(config, logger, { bot });
  await new Promise<void>((resolve) => server.httpServer.listen(config.port, config.host, resolve));
  logger.info({ event: 'listening', port: config.port }, 'server listening');

  if (bot) {
    if (config.botMode === 'webhook') void bot.startWebhook(config.publicUrl!);
    else void bot.startPolling();
  }

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.warn({ event: 'shutdown', signal }, 'shutting down: live games in memory will end');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    bot?.stop();
    await server.close().catch((err: unknown) => logger.error({ err }, 'server close failed'));
    await db.stop().catch((err: unknown) => logger.error({ err }, 'db close failed'));
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});

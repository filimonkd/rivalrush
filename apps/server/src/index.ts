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

  const db = await connectDatabase({
    uri: config.mongoUri,
    dbName: config.mongoDbName,
    allowInMemory: config.nodeEnv === 'development',
    logger,
  });
  const server = buildServer(config, logger);
  await new Promise<void>((resolve) => server.httpServer.listen(config.port, config.host, resolve));
  logger.info({ event: 'listening', port: config.port }, 'server listening');

  let bot: TelegramBot | null = null;
  if (config.botPolling && config.botToken && config.webAppUrl) {
    bot = new TelegramBot({ token: config.botToken, webAppUrl: config.webAppUrl, logger });
    void bot.start();
  } else if (config.botPolling) {
    logger.warn('BOT_POLLING is on but BOT_TOKEN or WEBAPP_URL is missing; bot not started');
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

import type { GameCatalogEntry, HealthResponse } from '@rivalrush/shared';
import cors from 'cors';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { isValidWebhookSecret, WEBHOOK_PATH, type TelegramBot, type TgUpdate } from '../bot/bot.js';
import type { AppConfig } from '../config/env.js';
import { isDatabaseUp } from '../db/connection.js';
import { listGames as defaultListGames } from '../games/registry.js';
import type { RoomRepository } from '../rooms/roomRepository.js';
import type { RoomManager } from '../rooms/roomManager.js';
import { VERSION } from '../version.js';
import { errorHandler, notFound, requestLogger, requireAuth, route } from './middleware.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes, profileRoutes } from './routes/me.js';
import { roomRoutes } from './routes/rooms.js';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  rooms: RoomManager;
  roomRepo: RoomRepository;
  /** The games catalog (defaults to the production-safe registry). */
  listGames?: () => GameCatalogEntry[];
  bot?: TelegramBot | null;
}

const rateLimited = { error: { code: 'RATE_LIMITED', message: 'Slow down a little.' } };

export function createApp({
  config,
  logger,
  rooms,
  roomRepo,
  listGames = defaultListGames,
  bot = null,
}: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

  app.use(helmet());
  app.use(
    cors({
      origin: config.clientOrigins,
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '16kb' }));
  app.use(requestLogger(logger));

  const health = (): HealthResponse => {
    const db = isDatabaseUp();
    return {
      status: db ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      version: VERSION,
      database: db ? 'up' : 'down',
    };
  };
  // Health is unauthenticated and reveals nothing about infrastructure.
  app.get('/health', (_req, res) => {
    const h = health();
    res.status(h.status === 'ok' ? 200 : 503).json(h);
  });
  app.get('/api/health', (_req, res) => {
    const h = health();
    res.status(h.status === 'ok' ? 200 : 503).json(h);
  });

  // Telegram webhook: authenticated by the secret-token header Telegram echoes back.
  // Answer 200 at once (Telegram retries otherwise) and handle the update afterwards.
  if (bot && config.botToken) {
    const botToken = config.botToken;
    app.post(WEBHOOK_PATH, (req, res) => {
      if (!isValidWebhookSecret(req.get('x-telegram-bot-api-secret-token'), botToken)) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Bad webhook secret.' } });
        return;
      }
      res.status(200).json({ ok: true });
      void bot.handleUpdate(req.body as TgUpdate);
    });
  }

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: rateLimited,
  });
  const authLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: rateLimited,
  });

  app.use('/api', apiLimiter);
  app.use('/api/auth', authLimiter, authRoutes(config, logger));

  const auth = requireAuth(config.jwtSecret);
  app.get(
    '/api/games',
    auth,
    route(() => ({ games: listGames() })),
  );
  app.use('/api/me', auth, meRoutes(rooms));
  app.use('/api/profile', auth, profileRoutes());
  app.use('/api/rooms', auth, roomRoutes(rooms, roomRepo));

  app.use(notFound());
  app.use(errorHandler(logger));
  return app;
}

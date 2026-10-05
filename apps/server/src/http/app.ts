import type { HealthResponse } from '@rivalrush/shared';
import cors from 'cors';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import { isDatabaseUp } from '../db/connection.js';
import { listGames } from '../games/registry.js';
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
}

const rateLimited = { error: { code: 'RATE_LIMITED', message: 'Slow down a little.' } };

export function createApp({ config, logger, rooms, roomRepo }: AppDeps): Express {
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

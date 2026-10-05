import {
  devAuthRequestSchema,
  parseInviteStartParam,
  telegramAuthRequestSchema,
  type AuthResponse,
} from '@rivalrush/shared';
import { Router } from 'express';
import type { Logger } from 'pino';
import { issueSession } from '../../auth/jwt.js';
import { validateInitData } from '../../auth/telegramAuth.js';
import type { AppConfig } from '../../config/env.js';
import { AppError } from '../../errors.js';
import { toPublicUser, upsertDevUser, upsertTelegramUser } from '../../users/userService.js';
import { parse, route } from '../middleware.js';

export function authRoutes(config: AppConfig, logger: Logger): Router {
  const r = Router();

  r.post(
    '/telegram',
    route(async (req): Promise<AuthResponse> => {
      const { initData } = parse(telegramAuthRequestSchema, req.body);
      if (!config.botToken)
        throw new AppError('INVALID_TELEGRAM_AUTH', 'Telegram sign-in is not configured.');
      let data;
      try {
        data = validateInitData(initData, config.botToken, {
          maxAgeSeconds: config.authMaxAgeSeconds,
        });
      } catch (err) {
        // Log the reason code only; never the payload.
        logger.warn(
          {
            event: 'auth.failed',
            code: err instanceof AppError ? err.code : 'UNKNOWN',
            why: err instanceof AppError ? err.details?.why : undefined,
          },
          'telegram auth failed',
        );
        throw err;
      }
      const inviteToken = parseInviteStartParam(data.startParam);
      const user = await upsertTelegramUser(data.user, inviteToken !== null);
      const session = issueSession(user.id as string, config.jwtSecret, config.jwtTtlSeconds);
      logger.info(
        { event: 'auth.success', userId: user.id as string, viaInvite: inviteToken !== null },
        'telegram auth ok',
      );
      return {
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
        user: toPublicUser(user),
        inviteToken,
      };
    }),
  );

  // Development-only shortcut. Config validation makes this impossible to enable in production.
  if (config.devLoginEnabled && !config.isProduction) {
    r.post(
      '/dev',
      route(async (req): Promise<AuthResponse> => {
        const { name } = parse(devAuthRequestSchema, req.body);
        const user = await upsertDevUser(name);
        const session = issueSession(user.id as string, config.jwtSecret, config.jwtTtlSeconds);
        logger.info({ event: 'auth.dev', userId: user.id as string }, 'dev login');
        return {
          token: session.token,
          expiresAt: session.expiresAt.toISOString(),
          user: toPublicUser(user),
          inviteToken: null,
        };
      }),
    );
  }

  return r;
}

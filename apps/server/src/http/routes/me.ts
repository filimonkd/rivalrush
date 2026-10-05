import type { ActiveRoomResponse, ProfileResponse, PublicUser } from '@rivalrush/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { RoomManager } from '../../rooms/roomManager.js';
import {
  getProfile,
  getUser,
  recentMatches,
  toPublicUser,
  toStats,
  winRate,
} from '../../users/userService.js';
import { parse, route, userIdOf } from '../middleware.js';

export function meRoutes(rooms: RoomManager): Router {
  const r = Router();

  r.get(
    '/',
    route(async (req): Promise<PublicUser> => toPublicUser(await getUser(userIdOf(req)))),
  );

  r.get(
    '/stats',
    route(async (req) => {
      const stats = toStats(await getUser(userIdOf(req)));
      return { stats, winRate: winRate(stats) };
    }),
  );

  r.get(
    '/active-room',
    route(async (req): Promise<ActiveRoomResponse> => ({
      room: await rooms.getActiveRoom(userIdOf(req)),
    })),
  );

  r.get(
    '/matches',
    route(async (req) => {
      const { limit } = parse(
        z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }),
        req.query,
      );
      return { matches: await recentMatches(userIdOf(req), limit) };
    }),
  );

  return r;
}

export function profileRoutes(): Router {
  const r = Router();
  r.get(
    '/:userId',
    route(async (req): Promise<ProfileResponse> => getProfile(String(req.params.userId))),
  );
  return r;
}

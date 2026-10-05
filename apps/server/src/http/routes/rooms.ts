import { randomUUID } from 'node:crypto';
import {
  createRoomRequestSchema,
  inviteTokenSchema,
  joinRoomRequestSchema,
  roomCommandRequestSchema,
  roomIdSchema,
  type InvitePreview,
  type RoomSnapshot,
  type RoomStateResponse,
} from '@rivalrush/shared';
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors.js';
import type { RoomRepository } from '../../rooms/roomRepository.js';
import type { RoomManager } from '../../rooms/roomManager.js';
import { getUser, toSeatIdentity } from '../../users/userService.js';
import { parse, route, userIdOf } from '../middleware.js';

export function roomRoutes(rooms: RoomManager, repo: RoomRepository): Router {
  const r = Router();
  const roomIdOf = (raw: unknown) => {
    const parsed = roomIdSchema.safeParse(raw);
    if (!parsed.success) throw new AppError('ROOM_NOT_FOUND');
    return parsed.data;
  };
  const actionIdOf = (body: unknown) =>
    parse(roomCommandRequestSchema, body ?? {}).actionId ?? randomUUID();

  r.post(
    '/',
    route(async (req, res): Promise<RoomSnapshot> => {
      const body = parse(createRoomRequestSchema, req.body);
      const user = toSeatIdentity(await getUser(userIdOf(req)));
      const snap = await rooms.createRoom(user, body.gameType, body.settings ?? {});
      res.status(201);
      return snap;
    }),
  );

  r.post(
    '/join',
    route(async (req): Promise<RoomSnapshot> => {
      const { inviteToken } = parse(joinRoomRequestSchema, req.body);
      const user = toSeatIdentity(await getUser(userIdOf(req)));
      return rooms.joinByInvite(user, inviteToken);
    }),
  );

  r.get(
    '/invite/:inviteToken',
    route(async (req): Promise<InvitePreview> => {
      const parsed = inviteTokenSchema.safeParse(req.params.inviteToken);
      if (!parsed.success) throw new AppError('ROOM_NOT_FOUND', "This invite link doesn't work.");
      const preview = await rooms.getInvitePreview(userIdOf(req), parsed.data);
      if (preview) return preview;
      // Not in memory any more: old invites explain themselves via persisted metadata.
      const status = await repo.statusByInviteToken(parsed.data).catch(() => null);
      if (status === 'EXPIRED') throw new AppError('ROOM_EXPIRED');
      if (status) throw new AppError('ROOM_CLOSED');
      throw new AppError('ROOM_NOT_FOUND', "This invite link doesn't work.");
    }),
  );

  r.get(
    '/:roomId',
    route(async (req): Promise<RoomSnapshot> =>
      rooms.getSnapshot(userIdOf(req), roomIdOf(req.params.roomId)),
    ),
  );

  r.get(
    '/:roomId/state',
    route(async (req): Promise<RoomStateResponse> => {
      const { knownVersion } = parse(
        z.object({ knownVersion: z.coerce.number().int().min(0).optional() }),
        req.query,
      );
      const room = await rooms.getSnapshot(userIdOf(req), roomIdOf(req.params.roomId));
      return knownVersion === room.version
        ? { changed: false, version: room.version }
        : { changed: true, room };
    }),
  );

  r.post(
    '/:roomId/leave',
    route(async (req) => {
      await rooms.leave(userIdOf(req), roomIdOf(req.params.roomId));
      return { left: true };
    }),
  );

  r.post(
    '/:roomId/start',
    route(async (req): Promise<RoomSnapshot> =>
      rooms.start(userIdOf(req), roomIdOf(req.params.roomId), actionIdOf(req.body)),
    ),
  );

  return r;
}

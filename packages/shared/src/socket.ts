import { z } from 'zod';
import type { AppErrorPayload } from './errors.js';
import type { RoomEvent, RoomSnapshot } from './rooms.js';
import { actionIdSchema, roomIdSchema } from './rooms.js';

/** Stable Socket.IO event names. */
export const SOCKET_EVENTS = {
  // client → server
  ROOM_SUBSCRIBE: 'room:subscribe',
  ROOM_READY: 'room:ready',
  ROOM_START: 'room:start',
  ROOM_LEAVE: 'room:leave',
  ROOM_REMATCH: 'room:rematch',
  GAME_ACTION: 'game:action',
  GAME_RESYNC: 'game:resync',
  // server → client
  ROOM_SNAPSHOT: 'room:snapshot',
  ROOM_EVENT: 'room:event',
  ROOM_CLOSED: 'room:closed',
  GAME_ERROR: 'game:error',
  SESSION_REPLACED: 'session:replaced',
} as const;

export type Ack<T> =
  { ok: true; data: T } | { ok: false; error: AppErrorPayload; snapshot?: RoomSnapshot };

export const subscribePayloadSchema = z.object({ roomId: roomIdSchema }).strict();
export const readyPayloadSchema = z
  .object({ roomId: roomIdSchema, ready: z.boolean(), actionId: actionIdSchema })
  .strict();
export const roomCommandPayloadSchema = z
  .object({ roomId: roomIdSchema, actionId: actionIdSchema })
  .strict();
export const gameActionPayloadSchema = z
  .object({
    roomId: roomIdSchema,
    actionId: actionIdSchema,
    clientVersion: z.number().int().min(0),
    // Shape is validated by the game's own schema on the server.
    action: z.object({ type: z.string().min(1).max(32) }).passthrough(),
  })
  .strict();
export const resyncPayloadSchema = z
  .object({ roomId: roomIdSchema, knownVersion: z.number().int().min(0).optional() })
  .strict();

export type SubscribePayload = z.infer<typeof subscribePayloadSchema>;
export type ReadyPayload = z.infer<typeof readyPayloadSchema>;
export type RoomCommandPayload = z.infer<typeof roomCommandPayloadSchema>;
export type GameActionPayload = z.infer<typeof gameActionPayloadSchema>;
export type ResyncPayload = z.infer<typeof resyncPayloadSchema>;

export type ResyncResult =
  { changed: false; version: number } | { changed: true; room: RoomSnapshot };

export interface RoomClosedPayload {
  roomId: string;
  reason: 'left' | 'expired' | 'closed';
}

export interface ClientToServerEvents {
  'room:subscribe': (p: SubscribePayload, ack: (r: Ack<RoomSnapshot>) => void) => void;
  'room:ready': (p: ReadyPayload, ack: (r: Ack<RoomSnapshot>) => void) => void;
  'room:start': (p: RoomCommandPayload, ack: (r: Ack<RoomSnapshot>) => void) => void;
  'room:leave': (p: RoomCommandPayload, ack: (r: Ack<{ left: true }>) => void) => void;
  'room:rematch': (p: RoomCommandPayload, ack: (r: Ack<RoomSnapshot>) => void) => void;
  'game:action': (p: GameActionPayload, ack: (r: Ack<RoomSnapshot>) => void) => void;
  'game:resync': (p: ResyncPayload, ack: (r: Ack<ResyncResult>) => void) => void;
}

export interface ServerToClientEvents {
  'room:snapshot': (snapshot: RoomSnapshot) => void;
  'room:event': (event: RoomEvent) => void;
  'room:closed': (payload: RoomClosedPayload) => void;
  'game:error': (error: AppErrorPayload) => void;
}

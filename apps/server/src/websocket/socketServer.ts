import type { Server as HttpServer } from 'node:http';
import {
  errorPayload,
  gameActionPayloadSchema,
  readyPayloadSchema,
  resyncPayloadSchema,
  roomCommandPayloadSchema,
  subscribePayloadSchema,
  type Ack,
  type ClientToServerEvents,
  type RoomEvent,
  type ServerToClientEvents,
} from '@rivalrush/shared';
import type { Logger } from 'pino';
import { Server, type Socket } from 'socket.io';
import type { ZodType } from 'zod';
import { verifySession } from '../auth/jwt.js';
import { AppError, toErrorPayload } from '../errors.js';
import type { RemovalReason, RoomManager } from '../rooms/roomManager.js';
import type { LiveRoom } from '../rooms/types.js';
import { TokenBucket } from './rateLimiter.js';

interface SocketData {
  userId: string;
  rooms: Set<string>;
}

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

const userChannel = (userId: string) => `user:${userId}`;

export interface SocketLayerOptions {
  jwtSecret: string;
  clientOrigins: string[];
  logger: Logger;
  /** Per-connection action throttle. */
  actionsPerSecond?: number;
  actionBurst?: number;
}

/**
 * Authenticated realtime gateway. Identity comes ONLY from the session token in the
 * handshake; socket ids and any user id inside payloads are never trusted.
 */
export class SocketLayer {
  readonly io: IO;
  private rooms!: RoomManager;
  private socketsByUser = new Map<string, Set<AppSocket>>();

  constructor(
    httpServer: HttpServer,
    private readonly opts: SocketLayerOptions,
  ) {
    this.io = new Server(httpServer, {
      cors: { origin: opts.clientOrigins, methods: ['GET', 'POST'] },
      maxHttpBufferSize: 16 * 1024,
      pingInterval: 20_000,
      pingTimeout: 20_000,
    });
    this.io.use((socket, next) => {
      try {
        const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
        const claims = verifySession(typeof token === 'string' ? token : null, opts.jwtSecret);
        socket.data.userId = claims.sub;
        socket.data.rooms = new Set();
        next();
      } catch {
        opts.logger.info({ event: 'socket.auth_failed' }, 'socket auth failed');
        next(new Error('UNAUTHORIZED'));
      }
    });
    this.io.on('connection', (socket) => this.onConnection(socket));
  }

  attach(rooms: RoomManager): void {
    this.rooms = rooms;
  }

  // ---------------------------------------------------------------- RoomManager hooks

  roomChanged(room: LiveRoom, events: RoomEvent[]): void {
    const now = Date.now();
    for (const seat of room.seats) {
      // Each player gets a snapshot built for them alone (their own secret only).
      const channel = this.io.to(userChannel(seat.userId));
      channel.emit('room:snapshot', this.rooms.snapshotFor(room, seat.userId, now));
      for (const e of events) channel.emit('room:event', e);
    }
  }

  userRemoved(roomId: string, userId: string, reason: RemovalReason): void {
    for (const s of this.socketsByUser.get(userId) ?? []) s.data.rooms.delete(roomId);
    this.io.to(userChannel(userId)).emit('room:closed', { roomId, reason });
  }

  async close(): Promise<void> {
    await this.io.close();
  }

  // ---------------------------------------------------------------- connection

  private onConnection(socket: AppSocket): void {
    const { userId } = socket.data;
    const log = this.opts.logger;
    void socket.join(userChannel(userId));
    let set = this.socketsByUser.get(userId);
    if (!set) this.socketsByUser.set(userId, (set = new Set()));
    set.add(socket);
    log.info({ event: 'socket.connected', userId }, 'socket connected');

    const bucket = new TokenBucket(this.opts.actionsPerSecond ?? 5, this.opts.actionBurst ?? 12);

    const handle = <P, R>(
      event: keyof ClientToServerEvents,
      schema: ZodType<P>,
      fn: (payload: P) => Promise<R>,
      onError?: (payload: P, err: AppError) => Promise<Partial<Ack<R>>>,
    ) => {
      (socket as unknown as { on(e: string, l: (raw: unknown, ack: unknown) => void): void }).on(
        event,
        async (raw, ack) => {
          const reply = typeof ack === 'function' ? (ack as (r: Ack<R>) => void) : () => undefined;
          if (!bucket.take()) {
            reply({ ok: false, error: errorPayload('RATE_LIMITED') });
            return;
          }
          const parsed = schema.safeParse(raw);
          if (!parsed.success) {
            reply({ ok: false, error: errorPayload('VALIDATION_ERROR') });
            return;
          }
          try {
            reply({ ok: true, data: await fn(parsed.data) });
          } catch (err) {
            if (!(err instanceof AppError))
              log.error({ err, event, userId }, 'socket handler failed');
            const extra =
              err instanceof AppError && onError
                ? await onError(parsed.data, err).catch(() => ({}))
                : {};
            reply({ ok: false, error: toErrorPayload(err), ...extra } as Ack<R>);
          }
        },
      );
    };

    // Presence must stay exact: one connect per (socket, room), and a disconnect that races
    // an in-flight subscribe is undone, so a player is never stuck "online".
    const inFlight = new Map<string, Promise<unknown>>();
    const subscribe = async (roomId: string) => {
      const pending = inFlight.get(roomId);
      if (pending) await pending.catch(() => undefined);
      if (socket.data.rooms.has(roomId)) return this.rooms.getSnapshot(userId, roomId);
      const p = this.rooms.connect(userId, roomId);
      inFlight.set(roomId, p);
      try {
        const snap = await p;
        if (socket.disconnected) {
          await this.rooms.disconnect(userId, roomId);
          return snap;
        }
        socket.data.rooms.add(roomId);
        return snap;
      } finally {
        inFlight.delete(roomId);
      }
    };

    // On a failed game action, hand back the authoritative snapshot so the client resyncs.
    const withSnapshot = async ({ roomId }: { roomId: string }) => {
      try {
        return { snapshot: await this.rooms.getSnapshot(userId, roomId) };
      } catch {
        return {};
      }
    };

    handle('room:subscribe', subscribePayloadSchema, ({ roomId }) => subscribe(roomId));
    handle('room:ready', readyPayloadSchema, (p) =>
      this.rooms.setReady(userId, p.roomId, p.ready, p.actionId),
    );
    handle('room:start', roomCommandPayloadSchema, (p) =>
      this.rooms.start(userId, p.roomId, p.actionId),
    );
    handle('room:rematch', roomCommandPayloadSchema, (p) =>
      this.rooms.rematch(userId, p.roomId, p.actionId),
    );
    handle('room:leave', roomCommandPayloadSchema, async (p) => {
      await this.rooms.leave(userId, p.roomId);
      socket.data.rooms.delete(p.roomId);
      return { left: true as const };
    });
    handle(
      'game:action',
      gameActionPayloadSchema,
      (p) => this.rooms.gameAction(userId, p),
      withSnapshot,
    );
    handle('game:resync', resyncPayloadSchema, async ({ roomId, knownVersion }) => {
      const room = await subscribe(roomId);
      return knownVersion === room.version
        ? { changed: false as const, version: room.version }
        : { changed: true as const, room };
    });

    socket.on('disconnect', (reason) => {
      set.delete(socket);
      if (set.size === 0) this.socketsByUser.delete(userId);
      log.info({ event: 'socket.disconnected', userId, reason }, 'socket disconnected');
      for (const roomId of socket.data.rooms) {
        void this.rooms.disconnect(userId, roomId).catch((err: unknown) => {
          log.error({ err, roomId, userId }, 'presence update failed');
        });
      }
      socket.data.rooms.clear();
    });
  }
}

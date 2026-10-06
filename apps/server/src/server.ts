import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import type { Logger } from 'pino';
import type { TelegramBot } from './bot/bot.js';
import type { AppConfig } from './config/env.js';
import type { AnyGameDefinition } from './games/engine/types.js';
import { createGameRegistry } from './games/registry.js';
import { createApp } from './http/app.js';
import { MatchRecorder, recordMatch, type FinishedSession } from './matches/matchService.js';
import { InMemoryRoomStore } from './rooms/InMemoryRoomStore.js';
import { RoomManager } from './rooms/roomManager.js';
import { RoomRepository } from './rooms/roomRepository.js';
import type { RoomStore } from './rooms/RoomStore.js';
import { SocketLayer } from './websocket/socketServer.js';

export interface RivalRushServer {
  httpServer: HttpServer;
  rooms: RoomManager;
  sockets: SocketLayer;
  recorder: MatchRecorder;
  roomRepo: RoomRepository;
  close(): Promise<void>;
}

export interface ServerOverrides {
  store?: RoomStore;
  now?: () => number;
  random?: () => number;
  recordMatch?: (s: FinishedSession) => Promise<'recorded' | 'duplicate'>;
  /** Telegram bot; when set, the app serves its webhook endpoint. */
  bot?: TelegramBot | null;
  /** Game lookup (tests only: games that aren't in the live registry yet). */
  games?: (id: string) => AnyGameDefinition | null;
}

/** Composition root: wires HTTP, Socket.IO, RoomManager and persistence. Does not listen. */
export function buildServer(
  config: AppConfig,
  logger: Logger,
  overrides: ServerOverrides = {},
): RivalRushServer {
  // Only the duels are registered unless Defuser is explicitly enabled (dev/test only).
  const registry = createGameRegistry({
    defuserEnabled: config.defuserEnabled,
    defuserFixedSeed: config.defuserFixedSeed,
    isProduction: config.isProduction,
  });
  const roomRepo = new RoomRepository(logger);
  const recorder = new MatchRecorder(logger, overrides.recordMatch ?? recordMatch);
  // Express must be the server's initial request listener so Socket.IO can wrap it and
  // claim /socket.io/ requests; the app itself is built once its dependencies exist.
  let app: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;
  const httpServer = createServer((req, res) => {
    if (app) app(req, res);
    else res.writeHead(503).end();
  });
  const sockets = new SocketLayer(httpServer, {
    jwtSecret: config.jwtSecret,
    clientOrigins: config.clientOrigins,
    logger,
  });
  const rooms = new RoomManager(
    overrides.store ?? new InMemoryRoomStore(),
    {
      roomChanged: (room, events) => sockets.roomChanged(room, events),
      userRemoved: (roomId, userId, reason) => sockets.userRemoved(roomId, userId, reason),
      gameFinished: (session) => void recorder.submit(session),
      persistRoom: (room) => roomRepo.persist(room),
    },
    logger,
    {
      roomTtlMs: config.roomTtlMs,
      disconnectGraceMs: config.disconnectGraceMs,
      ...(overrides.now ? { now: overrides.now } : {}),
      ...(overrides.random ? { random: overrides.random } : {}),
      games: overrides.games ?? registry.get,
    },
  );
  sockets.attach(rooms);
  app = createApp({
    config,
    logger,
    rooms,
    roomRepo,
    listGames: registry.list,
    bot: overrides.bot ?? null,
  });

  return {
    httpServer,
    rooms,
    sockets,
    recorder,
    roomRepo,
    async close() {
      rooms.shutdown();
      await sockets.close();
      if (httpServer.listening) await new Promise<void>((r) => httpServer.close(() => r()));
      await recorder.drain();
      await roomRepo.drain();
    },
  };
}

import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import type {
  AuthResponse,
  ClientToServerEvents,
  RoomSnapshot,
  ServerToClientEvents,
} from '@rivalrush/shared';
import mongoose from 'mongoose';
import { io as ioClient, type Socket } from 'socket.io-client';
import request from 'supertest';
import { signInitData } from '../../src/auth/telegramAuth.js';
import { loadConfig, type AppConfig } from '../../src/config/env.js';
import { createLogger } from '../../src/logger.js';
import { buildServer, type RivalRushServer, type ServerOverrides } from '../../src/server.js';

export const BOT_TOKEN = '7000000001:TEST_ONLY_bot_token_value';

/**
 * Integration environment: a real MongoDB replica set (mongodb-memory-server, or
 * MONGODB_TEST_URI), a listening server, and a log sink so tests can assert on logs.
 */
export async function startTestServer(
  env: Record<string, string> = {},
  overrides: ServerOverrides = {},
) {
  let stopReplSet: (() => Promise<unknown>) | null = null;
  let uri = process.env.MONGODB_TEST_URI;
  if (!uri) {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const rs = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    uri = rs.getUri();
    stopReplSet = () => rs.stop();
  }
  await mongoose.connect(uri, { dbName: `rivalrush_test_${randomUUID().slice(0, 8)}` });
  await mongoose.connection.syncIndexes();

  const logLines: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      logLines.push(String(chunk));
      cb();
    },
  });
  const config: AppConfig = loadConfig({
    NODE_ENV: 'test',
    BOT_TOKEN,
    JWT_SECRET: 'integration-test-secret-'.padEnd(48, 'x'),
    DEV_LOGIN_ENABLED: 'true',
    CLIENT_ORIGINS: 'http://localhost:5173',
    LOG_LEVEL: 'debug',
    ...env,
  });
  const logger = createLogger('debug', sink);
  const server: RivalRushServer = buildServer(config, logger, overrides);
  await new Promise<void>((r) => server.httpServer.listen(0, '127.0.0.1', r));
  const port = (server.httpServer.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;
  const sockets: Socket[] = [];

  return {
    server,
    config,
    url,
    logLines,
    http: () => request(server.httpServer),
    async telegramLogin(
      user: { id: number; first_name: string; username?: string },
      extra: Record<string, string> = {},
    ) {
      const initData = signInitData(
        {
          user: JSON.stringify(user),
          auth_date: String(Math.floor(Date.now() / 1000)),
          query_id: 'AAE',
          ...extra,
        },
        BOT_TOKEN,
      );
      const res = await request(server.httpServer)
        .post('/api/auth/telegram')
        .send({ initData })
        .expect(200);
      return res.body as AuthResponse;
    },
    connect(token: string | null): Socket<ServerToClientEvents, ClientToServerEvents> {
      const s = ioClient(url, {
        auth: token ? { token } : {},
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      sockets.push(s);
      return s;
    },
    async stop() {
      for (const s of sockets) s.disconnect();
      await server.close();
      await mongoose.connection.dropDatabase().catch(() => undefined);
      await mongoose.disconnect();
      if (stopReplSet) await stopReplSet();
    },
  };
}

export type TestEnv = Awaited<ReturnType<typeof startTestServer>>;

export function emit<T>(
  socket: Socket,
  event: string,
  payload: unknown,
): Promise<{ ok: boolean; data?: T; error?: { code: string }; snapshot?: RoomSnapshot }> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

export function waitFor<T>(
  socket: Socket,
  event: string,
  predicate: (v: T) => boolean = () => true,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    const handler = (v: T) => {
      if (!predicate(v)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(v);
    };
    socket.on(event, handler);
  });
}

export function connected(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.connected) return resolve();
    socket.once('connect', () => resolve());
    socket.once('connect_error', (err) => reject(err));
  });
}

let counter = 0;
export const actionId = () => `it_${Date.now().toString(36)}_${(++counter).toString(36)}`;

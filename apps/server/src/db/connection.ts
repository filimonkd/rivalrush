import mongoose from 'mongoose';
import type { Logger } from 'pino';

export interface DbHandle {
  /** Stops anything this module started (in-memory dev database). */
  stop(): Promise<void>;
}

mongoose.set('strictQuery', true);
// Never let a query silently buffer while disconnected: fail fast instead.
mongoose.set('bufferCommands', false);

/**
 * Connects Mongoose. In development without MONGODB_URI, starts a throwaway in-memory
 * replica set (mongodb-memory-server is a dev dependency) so `npm run dev` just works.
 * Production always requires MONGODB_URI (enforced by config validation).
 */
export async function connectDatabase(opts: {
  uri: string | null;
  dbName?: string | undefined;
  allowInMemory: boolean;
  logger: Logger;
}): Promise<DbHandle> {
  let uri = opts.uri;
  let stopMemory: (() => Promise<unknown>) | null = null;
  if (!uri) {
    if (!opts.allowInMemory) throw new Error('MONGODB_URI is required');
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const rs = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    uri = rs.getUri();
    stopMemory = () => rs.stop();
    opts.logger.warn('MONGODB_URI not set: using an in-memory database (data is lost on restart)');
  }
  await mongoose.connect(uri, {
    dbName: opts.dbName,
    serverSelectionTimeoutMS: 15_000,
    maxPoolSize: 20,
    retryWrites: true,
  });
  await mongoose.connection.syncIndexes();
  opts.logger.info({ db: mongoose.connection.name }, 'database connected');
  return {
    async stop() {
      await mongoose.disconnect();
      if (stopMemory) await stopMemory();
    },
  };
}

export function isDatabaseUp(): boolean {
  return mongoose.connection.readyState === 1;
}

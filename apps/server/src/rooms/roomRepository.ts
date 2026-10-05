import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import { RoomModel } from './Room.model.js';
import type { LiveRoom } from './types.js';

const PURGE_AFTER_MS = 30 * 24 * 3600 * 1000;

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Best-effort persistence of room metadata. Failures are logged, never thrown into gameplay. */
export class RoomRepository {
  private chain = new Map<string, Promise<void>>();

  constructor(private readonly logger: Logger) {}

  persist(room: LiveRoom): void {
    const snapshot = {
      roomId: room.roomId,
      inviteTokenHash: hashInviteToken(room.inviteToken),
      gameType: room.gameType,
      settings: room.settings,
      hostId: room.hostId,
      playerIds: room.seats.map((s) => s.userId),
      seats: room.seats.length,
      status: room.status,
      gamesPlayed: room.gamesPlayed,
      expiresAt: new Date(room.expiresAt),
      purgeAt: new Date(room.expiresAt + PURGE_AFTER_MS),
    };
    // Writes for one room are chained so they land in order.
    const prev = this.chain.get(room.roomId) ?? Promise.resolve();
    const next = prev
      .then(async () => {
        const { seats, ...fields } = snapshot;
        await RoomModel.updateOne(
          { roomId: snapshot.roomId },
          { $set: fields, $max: { peakPlayers: seats } },
          { upsert: true },
        );
      })
      .catch((err: unknown) => {
        this.logger.warn({ err, roomId: room.roomId }, 'room metadata write failed');
      });
    this.chain.set(room.roomId, next);
    void next.then(() => {
      if (this.chain.get(room.roomId) === next) this.chain.delete(room.roomId);
    });
  }

  /** Status of a room that is no longer in memory (old invite links). */
  async statusByInviteToken(token: string): Promise<string | null> {
    const doc = await RoomModel.findOne(
      { inviteTokenHash: hashInviteToken(token) },
      { status: 1 },
    ).lean();
    return doc?.status ?? null;
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.chain.values()]);
  }
}

import type { Logger } from 'pino';
import { GameStartModel } from './GameStart.model.js';

/** A game session that just started. Contains no secrets and no names. */
export interface StartedSession {
  sessionId: string;
  roomId: string;
  gameType: string;
  isRematch: boolean;
  players: number;
  startedAt: number;
}

/** Idempotent: a sessionId is stored at most once. */
export async function recordGameStart(s: StartedSession): Promise<void> {
  await GameStartModel.updateOne(
    { sessionId: s.sessionId },
    { $setOnInsert: { ...s, startedAt: new Date(s.startedAt) } },
    { upsert: true },
  );
}

/** Best-effort writer: a failed write is logged, never thrown into gameplay. */
export class GameStartLog {
  private pending = new Set<Promise<void>>();

  constructor(
    private readonly logger: Logger,
    private readonly write: (s: StartedSession) => Promise<void> = recordGameStart,
  ) {}

  submit(s: StartedSession): void {
    const p = this.write(s)
      .catch((err: unknown) => {
        this.logger.warn(
          { err, roomId: s.roomId, sessionId: s.sessionId },
          'game start write failed',
        );
      })
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }
}

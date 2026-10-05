import type { CtcMove, GameResult } from '@rivalrush/shared';
import mongoose, { Types } from 'mongoose';
import type { Logger } from 'pino';
import { UserModel } from '../users/User.model.js';
import { MatchModel } from './Match.model.js';

/** Everything needed to record one finished game session. Contains no secrets. */
export interface FinishedSession {
  sessionId: string;
  roomId: string;
  gameType: string;
  settings: Record<string, unknown>;
  isRematch: boolean;
  players: Array<{ userId: string; displayName: string; photoUrl: string | null }>;
  result: GameResult;
  moves: CtcMove[];
  startedAt: number;
  endedAt: number;
}

type Outcome = 'win' | 'loss' | 'draw';

export function outcomeFor(result: GameResult, userId: string): Outcome {
  if (result.outcome === 'draw') return 'draw';
  return result.winnerId === userId ? 'win' : 'loss';
}

const n = (field: string) => ({ $ifNull: [`$stats.${field}`, 0] });

/** Aggregation-pipeline update so streaks are computed atomically from the stored values. */
function statsUpdate(outcome: Outcome) {
  const set: Record<string, unknown> = {
    'stats.gamesPlayed': { $add: [n('gamesPlayed'), 1] },
  };
  if (outcome === 'win') {
    set['stats.wins'] = { $add: [n('wins'), 1] };
    set['stats.currentStreak'] = { $add: [n('currentStreak'), 1] };
    set['stats.bestStreak'] = { $max: [n('bestStreak'), { $add: [n('currentStreak'), 1] }] };
  } else {
    set[outcome === 'loss' ? 'stats.losses' : 'stats.draws'] = {
      $add: [n(outcome === 'loss' ? 'losses' : 'draws'), 1],
    };
    // A loss or a draw ends a win streak.
    set['stats.currentStreak'] = 0;
  }
  return [{ $set: set }];
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * Records the match and updates both players' stats in ONE transaction, so history and
 * stats can never disagree. Idempotent: a sessionId is recorded at most once.
 */
export async function recordMatch(s: FinishedSession): Promise<'recorded' | 'duplicate'> {
  const session = await mongoose.startSession();
  try {
    let outcome: 'recorded' | 'duplicate' = 'recorded';
    await session.withTransaction(async () => {
      outcome = 'recorded';
      if (await MatchModel.exists({ sessionId: s.sessionId }).session(session)) {
        outcome = 'duplicate';
        return;
      }
      // A concurrent duplicate insert fails the unique index; that error aborts this
      // transaction (no partial stats) and is reported as 'duplicate' below.
      await MatchModel.create(
        [
          {
            sessionId: s.sessionId,
            roomId: s.roomId,
            gameType: s.gameType,
            settings: s.settings,
            isRematch: s.isRematch,
            players: s.players.map((p) => ({
              userId: new Types.ObjectId(p.userId),
              displayName: p.displayName,
              photoUrl: p.photoUrl,
              outcome: outcomeFor(s.result, p.userId),
              turns: s.moves.filter((m) => m.playerId === p.userId).length,
            })),
            result: s.result,
            moves: s.moves.map((m) => ({ ...m, at: new Date(m.at) })),
            startedAt: new Date(s.startedAt),
            endedAt: new Date(s.endedAt),
          },
        ],
        { session },
      );
      for (const p of s.players) {
        await UserModel.updateOne({ _id: p.userId }, statsUpdate(outcomeFor(s.result, p.userId)), {
          session,
          updatePipeline: true,
        });
      }
    });
    return outcome;
  } catch (err) {
    if (isDuplicateKey(err)) return 'duplicate';
    throw err;
  } finally {
    await session.endSession();
  }
}

/**
 * Retries recording with backoff so a transient database blip does not lose a result.
 * (If the process dies before success, the result is lost together with all live state —
 * the documented MVP trade-off of in-memory rooms.)
 */
export class MatchRecorder {
  private pending = new Set<Promise<unknown>>();

  constructor(
    private readonly logger: Logger,
    private readonly record: (
      s: FinishedSession,
    ) => Promise<'recorded' | 'duplicate'> = recordMatch,
    private readonly delaysMs: number[] = [500, 2000, 5000, 15000, 30000],
  ) {}

  submit(s: FinishedSession): Promise<void> {
    const p = this.run(s).finally(() => this.pending.delete(p));
    this.pending.add(p);
    return p;
  }

  private async run(s: FinishedSession): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await this.record(s);
        this.logger.info(
          {
            event: 'match.recorded',
            sessionId: s.sessionId,
            roomId: s.roomId,
            reason: s.result.reason,
            duplicate: r === 'duplicate',
          },
          'match recorded',
        );
        return;
      } catch (err) {
        const delay = this.delaysMs[attempt];
        if (delay === undefined) {
          this.logger.error(
            { event: 'match.record_failed', sessionId: s.sessionId, err },
            'giving up recording match',
          );
          return;
        }
        this.logger.warn(
          { event: 'match.record_retry', sessionId: s.sessionId, attempt, err },
          'retrying match record',
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  /** Waits for in-flight recordings (graceful shutdown, tests). */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }
}

import {
  isCoopResult,
  type AnyGameResult,
  type CoopIndividualResult,
  type CoopPlayerRecord,
  type GameMove,
} from '@rivalrush/shared';
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
  players: Array<{
    userId: string;
    displayName: string;
    photoUrl: string | null;
    /** Co-op games only: roles and final status (from the game's own state). */
    coop?: CoopPlayerRecord;
  }>;
  result: AnyGameResult;
  moves: GameMove[];
  startedAt: number;
  endedAt: number;
  /** Generated-puzzle games only. Stored with `select: false`; never returned by any API. */
  generator?: { version: number; seed: string };
}

export type Outcome = 'win' | 'loss' | 'draw' | CoopIndividualResult;

export function outcomeFor(result: AnyGameResult, userId: string): Outcome {
  if (isCoopResult(result)) {
    // Every player in the game at the start has an individual result. A missing one would be a
    // plug-in bug; count it as a played game only, never as a win or a loss.
    return result.individual[userId] ?? 'coop_unfinished';
  }
  if (result.outcome === 'draw') return 'draw';
  return result.winnerId === userId ? 'win' : 'loss';
}

/** Co-op history counts accepted Operator inputs for the whole team (docs/defuser.md 17). */
function turnsFor(s: FinishedSession, userId: string): number {
  if (isCoopResult(s.result))
    return s.moves.filter((m) => 'kind' in m && m.kind === 'input').length;
  return s.moves.filter((m) => m.playerId === userId).length;
}

const n = (field: string) => ({ $ifNull: [`$stats.${field}`, 0] });

/**
 * Co-op results update only `stats.coop`. They never read or write the competitive fields
 * (gamesPlayed, wins, losses, draws, currentStreak, bestStreak), so a co-op game neither
 * extends nor resets a streak.
 */
function coopStatsUpdate(outcome: CoopIndividualResult) {
  const set: Record<string, unknown> = {
    'stats.coop.played': { $add: [n('coop.played'), 1] },
  };
  if (outcome === 'coop_win') set['stats.coop.wins'] = { $add: [n('coop.wins'), 1] };
  if (outcome === 'coop_loss') set['stats.coop.losses'] = { $add: [n('coop.losses'), 1] };
  if (outcome === 'coop_dropped') set['stats.coop.dropped'] = { $add: [n('coop.dropped'), 1] };
  return [{ $set: set }];
}

/** Aggregation-pipeline update so streaks are computed atomically from the stored values. */
export function statsUpdate(outcome: Outcome) {
  if (outcome !== 'win' && outcome !== 'loss' && outcome !== 'draw') {
    return coopStatsUpdate(outcome);
  }
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
              turns: turnsFor(s, p.userId),
              ...(p.coop ? { coop: p.coop } : {}),
            })),
            result: s.result,
            moves: s.moves.map((m) => ({ ...m, at: new Date(m.at) })),
            ...(s.generator ? { generator: s.generator } : {}),
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

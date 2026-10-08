import type { PipelineStage } from 'mongoose';
import { MatchModel } from '../matches/Match.model.js';
import { RoomModel } from '../rooms/Room.model.js';
import { UserModel } from '../users/User.model.js';
import { GameStartModel } from './GameStart.model.js';

/**
 * Closed-beta metrics (docs/beta-plan.md#metrics), computed read-only from the database.
 * Every query is an aggregation or a count: nothing here writes, and no name, username,
 * secret or seed leaves this module (only counts and game ids).
 */

/** Endings where the game was played to its end ("match completion" numerator). */
export const NORMAL_REASONS = [
  'cracked',
  'both_cracked',
  'out_of_guesses',
  'defused',
  'faults',
  'timer',
] as const;

export interface ReportWindow {
  since: Date;
  until: Date;
  /** IANA time zone for day boundaries (multi-day players, the daily table). */
  timeZone: string;
}

/** Telegram ids and @usernames of the people on the tester list. */
export interface TesterList {
  ids: Set<number>;
  usernames: Set<string>;
}

export interface DailyRow {
  day: string;
  rooms: number;
  joined: number;
  started: number;
  matches: number;
  normal: number;
  abandoned: number;
  rematches: number;
  players: number;
}

export interface BetaReport {
  window: { since: string; until: string; timeZone: string };
  rooms: { created: number; joined: number };
  /** `trackedSince` is the first start ever recorded; earlier games are only in the logs. */
  starts: { started: number; unfinished: number; trackedSince: string | null };
  matches: {
    total: number;
    normal: number;
    forfeit: number;
    abandoned: number;
    rematches: number;
    byReason: Record<string, number>;
    byGame: Array<{ gameType: string; matches: number; rematches: number; abandoned: number }>;
  };
  players: { players: number; totalGames: number; threePlusGames: number; multiDay: number };
  /** Players whose first game was in the window and at least 7 days before `until`. */
  daySeven: { eligible: number; returned: number };
  users: { newUsers: number; viaInvite: number };
  /** Null without a tester list. */
  outsiders: number | null;
  daily: DailyRow[];
}

const DAY_MS = 24 * 3600 * 1000;
const NORMAL: string[] = [...NORMAL_REASONS];

async function one<T>(rows: Promise<T[]>): Promise<T | undefined> {
  return (await rows)[0];
}

const dayOf = (field: string, timeZone: string) => ({
  $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: timeZone },
});

export async function computeBetaReport(
  w: ReportWindow,
  testers: TesterList | null = null,
): Promise<BetaReport> {
  const { since, until, timeZone } = w;
  const created = { createdAt: { $gte: since, $lt: until } };
  const ended = { endedAt: { $gte: since, $lt: until } };
  const startedIn = { startedAt: { $gte: since, $lt: until } };

  const [rooms, starts, unfinished, firstStart, reasons, byGame, perPlayer, dayRows, users] =
    await Promise.all([
      one(
        RoomModel.aggregate<{ created: number; joined: number }>([
          { $match: created },
          {
            $group: {
              _id: null,
              created: { $sum: 1 },
              joined: { $sum: { $cond: [{ $gte: ['$peakPlayers', 2] }, 1, 0] } },
            },
          },
        ]),
      ),
      GameStartModel.countDocuments(startedIn),
      one(
        GameStartModel.aggregate<{ n: number }>([
          { $match: startedIn },
          {
            $lookup: {
              from: MatchModel.collection.name,
              localField: 'sessionId',
              foreignField: 'sessionId',
              as: 'm',
            },
          },
          { $match: { m: { $size: 0 } } },
          { $count: 'n' },
        ]),
      ),
      GameStartModel.findOne({}, { startedAt: 1 }).sort({ startedAt: 1 }).lean(),
      MatchModel.aggregate<{ _id: string; matches: number; rematches: number }>([
        { $match: ended },
        {
          $group: {
            _id: '$result.reason',
            matches: { $sum: 1 },
            rematches: { $sum: { $cond: ['$isRematch', 1, 0] } },
          },
        },
      ]),
      MatchModel.aggregate<{ _id: string; matches: number; rematches: number; abandoned: number }>([
        { $match: ended },
        {
          $group: {
            _id: '$gameType',
            matches: { $sum: 1 },
            rematches: { $sum: { $cond: ['$isRematch', 1, 0] } },
            abandoned: { $sum: { $cond: [{ $eq: ['$result.reason', 'abandoned'] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      MatchModel.aggregate<{ _id: unknown; games: number; days: string[] }>([
        { $match: ended },
        { $unwind: '$players' },
        {
          $group: {
            _id: '$players.userId',
            games: { $sum: 1 },
            days: { $addToSet: dayOf('endedAt', timeZone) },
          },
        },
      ]),
      dailyRows(w),
      one(
        UserModel.aggregate<{ newUsers: number; viaInvite: number }>([
          { $match: { ...created, isDev: { $ne: true } } },
          {
            $group: {
              _id: null,
              newUsers: { $sum: 1 },
              viaInvite: { $sum: { $cond: ['$acquisition.viaInvite', 1, 0] } },
            },
          },
        ]),
      ),
    ]);

  const byReason: Record<string, number> = {};
  let total = 0;
  let rematches = 0;
  for (const r of reasons) {
    byReason[r._id] = r.matches;
    total += r.matches;
    rematches += r.rematches;
  }
  const sum = (keys: string[]) => keys.reduce((n, k) => n + (byReason[k] ?? 0), 0);

  return {
    window: { since: since.toISOString(), until: until.toISOString(), timeZone },
    rooms: { created: rooms?.created ?? 0, joined: rooms?.joined ?? 0 },
    starts: {
      started: starts,
      unfinished: unfinished?.n ?? 0,
      trackedSince: firstStart ? new Date(firstStart.startedAt).toISOString() : null,
    },
    matches: {
      total,
      normal: sum(NORMAL),
      forfeit: sum(['forfeit']),
      abandoned: sum(['abandoned']),
      rematches,
      byReason,
      byGame: byGame.map((g) => ({
        gameType: g._id,
        matches: g.matches,
        rematches: g.rematches,
        abandoned: g.abandoned,
      })),
    },
    players: {
      players: perPlayer.length,
      totalGames: perPlayer.reduce((n, p) => n + p.games, 0),
      threePlusGames: perPlayer.filter((p) => p.games >= 3).length,
      multiDay: perPlayer.filter((p) => p.days.length >= 2).length,
    },
    daySeven: await daySeven(w),
    users: { newUsers: users?.newUsers ?? 0, viaInvite: users?.viaInvite ?? 0 },
    outsiders: testers
      ? await outsiders(
          perPlayer.map((p) => p._id),
          testers,
        )
      : null,
    daily: dayRows,
  };
}

/** First game in the window and 7+ days before `until`; returned = played again 7+ days later. */
async function daySeven({ since, until }: ReportWindow) {
  const cutoff = new Date(until.getTime() - 7 * DAY_MS);
  const row = await one(
    MatchModel.aggregate<{ eligible: number; returned: number }>([
      { $match: { endedAt: { $lt: until } } },
      { $unwind: '$players' },
      {
        $group: {
          _id: '$players.userId',
          first: { $min: '$endedAt' },
          last: { $max: '$endedAt' },
        },
      },
      { $match: { first: { $gte: since, $lte: cutoff } } },
      {
        $group: {
          _id: null,
          eligible: { $sum: 1 },
          returned: {
            $sum: { $cond: [{ $gte: ['$last', { $add: ['$first', 7 * DAY_MS] }] }, 1, 0] },
          },
        },
      },
    ]),
  );
  return { eligible: row?.eligible ?? 0, returned: row?.returned ?? 0 };
}

async function outsiders(userIds: unknown[], testers: TesterList): Promise<number> {
  const users = await UserModel.find(
    { _id: { $in: userIds } },
    { telegramId: 1, username: 1 },
  ).lean();
  return users.filter(
    (u) =>
      !testers.ids.has(u.telegramId) &&
      !(u.username && testers.usernames.has(u.username.toLowerCase())),
  ).length;
}

async function dailyRows(w: ReportWindow): Promise<DailyRow[]> {
  const { since, until, timeZone } = w;
  const byDay = (field: string, extra: Record<string, unknown>): PipelineStage[] => [
    { $match: { [field]: { $gte: since, $lt: until } } },
    { $group: { _id: dayOf(field, timeZone), ...extra } },
  ];
  const [rooms, starts, matches, players] = await Promise.all([
    RoomModel.aggregate<{ _id: string; rooms: number; joined: number }>(
      byDay('createdAt', {
        rooms: { $sum: 1 },
        joined: { $sum: { $cond: [{ $gte: ['$peakPlayers', 2] }, 1, 0] } },
      }),
    ),
    GameStartModel.aggregate<{ _id: string; started: number }>(
      byDay('startedAt', { started: { $sum: 1 } }),
    ),
    MatchModel.aggregate<{
      _id: string;
      matches: number;
      normal: number;
      abandoned: number;
      rematches: number;
    }>(
      byDay('endedAt', {
        matches: { $sum: 1 },
        normal: { $sum: { $cond: [{ $in: ['$result.reason', NORMAL] }, 1, 0] } },
        abandoned: { $sum: { $cond: [{ $eq: ['$result.reason', 'abandoned'] }, 1, 0] } },
        rematches: { $sum: { $cond: ['$isRematch', 1, 0] } },
      }),
    ),
    MatchModel.aggregate<{ _id: string; players: number }>([
      ...byDay('endedAt', { ids: { $addToSet: '$players.userId' } }),
      {
        $project: {
          players: {
            $size: {
              $reduce: {
                input: '$ids',
                initialValue: [],
                in: { $setUnion: ['$$value', '$$this'] },
              },
            },
          },
        },
      },
    ]),
  ]);
  const rows = new Map<string, DailyRow>();
  const row = (day: string) => {
    let r = rows.get(day);
    if (!r) {
      r = {
        day,
        rooms: 0,
        joined: 0,
        started: 0,
        matches: 0,
        normal: 0,
        abandoned: 0,
        rematches: 0,
        players: 0,
      };
      rows.set(day, r);
    }
    return r;
  };
  for (const r of rooms) Object.assign(row(r._id), { rooms: r.rooms, joined: r.joined });
  for (const s of starts) row(s._id).started = s.started;
  for (const m of matches) {
    Object.assign(row(m._id), {
      matches: m.matches,
      normal: m.normal,
      abandoned: m.abandoned,
      rematches: m.rematches,
    });
  }
  for (const p of players) row(p._id).players = p.players;
  return [...rows.values()].sort((a, b) => a.day.localeCompare(b.day));
}

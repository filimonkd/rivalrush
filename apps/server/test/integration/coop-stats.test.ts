import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CoopIndividualResult, CoopResult, DefuserMove } from '@rivalrush/shared';
import { recordMatch, type FinishedSession } from '../../src/matches/matchService.js';
import { MatchModel } from '../../src/matches/Match.model.js';
import { UserModel } from '../../src/users/User.model.js';
import { startTestServer, type TestEnv } from '../helpers/integration.js';

/**
 * Co-op recording against a real MongoDB replica set: co-op results update only stats.coop,
 * history carries teammates and roles, and the server-only generator seed never leaves the DB.
 * (No Defuser plug-in exists yet; sessions are built by hand in the shape it will produce.)
 */
let env: TestEnv;
beforeAll(async () => {
  env = await startTestServer();
});
afterAll(async () => {
  await env?.stop();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const SEED = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';

function coopSession(
  ids: string[],
  outcome: CoopResult['outcome'],
  individual: CoopIndividualResult[],
  over: Partial<FinishedSession> = {},
): FinishedSession {
  const now = Date.now();
  const moves: DefuserMove[] = [
    {
      kind: 'input',
      playerId: ids[0]!,
      panel: 'fuse',
      input: { line: 3 },
      ok: false,
      at: now - 50_000,
      atMs: 10_000,
    },
    {
      kind: 'input',
      playerId: ids[0]!,
      panel: 'fuse',
      input: { line: 5 },
      ok: true,
      at: now - 40_000,
      atMs: 20_000,
    },
    {
      kind: 'system',
      playerId: ids[ids.length - 1]!,
      event: 'timed_out',
      at: now - 30_000,
      atMs: 30_000,
    },
  ];
  return {
    sessionId: `coop-${Math.random().toString(36).slice(2)}`,
    roomId: 'room12345678',
    gameType: 'defuser',
    settings: { difficulty: 'normal' },
    isRematch: false,
    players: ids.map((userId, i) => ({
      userId,
      displayName: `P${i + 1}`,
      photoUrl: null,
      coop: {
        startRole: i === 0 ? 'operator' : 'analyst',
        finalRole: i === 0 ? 'operator' : 'analyst',
        letter: i === 0 ? null : 'ABC'[i - 1]!,
        finalStatus: individual[i] === 'coop_dropped' ? 'timed_out' : 'active',
        rejoined: false,
      },
    })),
    result: {
      kind: 'coop',
      outcome,
      reason: outcome === 'defused' ? 'defused' : outcome === 'detonated' ? 'faults' : 'abandoned',
      panelsSolved: outcome === 'defused' ? 3 : 1,
      faults: 1,
      msRemaining: outcome === 'defused' ? 72_000 : 0,
      individual: Object.fromEntries(ids.map((id, i) => [id, individual[i]!])),
    },
    moves,
    startedAt: now - 60_000,
    endedAt: now,
    generator: { version: 1, seed: SEED },
    ...over,
  };
}

const COMPETITIVE_ZERO = {
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  currentStreak: 0,
  bestStreak: 0,
};

describe('co-op stats', () => {
  it('win, loss, unfinished and dropped update only stats.coop; recording is idempotent', async () => {
    const a = (await env.telegramLogin({ id: 9001, first_name: 'Op' })).user.id;
    const b = (await env.telegramLogin({ id: 9002, first_name: 'An' })).user.id;
    const c = (await env.telegramLogin({ id: 9003, first_name: 'Bo' })).user.id;
    const win = coopSession([a, b, c], 'defused', ['coop_win', 'coop_win', 'coop_dropped']);
    expect(await recordMatch(win)).toBe('recorded');
    expect(await recordMatch(win)).toBe('duplicate');
    await Promise.all([recordMatch(win), recordMatch(win)]);
    expect(await MatchModel.countDocuments({ sessionId: win.sessionId })).toBe(1);
    await recordMatch(coopSession([a, b, c], 'detonated', ['coop_loss', 'coop_loss', 'coop_loss']));
    await recordMatch(coopSession([a, b], 'abandoned', ['coop_unfinished', 'coop_dropped']));

    const ua = (await UserModel.findById(a).lean())!.stats;
    const ub = (await UserModel.findById(b).lean())!.stats;
    const uc = (await UserModel.findById(c).lean())!.stats;
    expect(ua).toMatchObject({
      ...COMPETITIVE_ZERO,
      coop: { played: 3, wins: 1, losses: 1, dropped: 0 },
    });
    expect(ub).toMatchObject({
      ...COMPETITIVE_ZERO,
      coop: { played: 3, wins: 1, losses: 1, dropped: 1 },
    });
    expect(uc).toMatchObject({
      ...COMPETITIVE_ZERO,
      coop: { played: 2, wins: 0, losses: 1, dropped: 1 },
    });
  });

  it('a user stored before co-op existed (no coop block) works for reads and updates', async () => {
    const a = (await env.telegramLogin({ id: 9101, first_name: 'Old' })).user.id;
    const b = (await env.telegramLogin({ id: 9102, first_name: 'New' })).user.id;
    await UserModel.collection.updateOne(
      { _id: new (await import('mongoose')).Types.ObjectId(a) },
      { $unset: { 'stats.coop': '' } },
    );
    const before = await env.telegramLogin({ id: 9101, first_name: 'Old' });
    expect(before.user.stats.coop).toEqual({ played: 0, wins: 0, losses: 0, dropped: 0 });
    await recordMatch(coopSession([a, b], 'defused', ['coop_win', 'coop_win']));
    expect((await UserModel.findById(a).lean())!.stats.coop).toMatchObject({ played: 1, wins: 1 });
  });

  it('a mixed sequence of duels and co-op games keeps the two stat blocks apart', async () => {
    const a = (await env.telegramLogin({ id: 9201, first_name: 'Mix' })).user.id;
    const b = (await env.telegramLogin({ id: 9202, first_name: 'Max' })).user.id;
    const duel = (winner: string): FinishedSession => ({
      sessionId: `duel-${Math.random().toString(36).slice(2)}`,
      roomId: 'room12345678',
      gameType: 'crack-the-code',
      settings: { codeLength: 4, turnSeconds: 45, maxGuesses: 10 },
      isRematch: false,
      players: [
        { userId: a, displayName: 'A', photoUrl: null },
        { userId: b, displayName: 'B', photoUrl: null },
      ],
      result: { outcome: 'win', winnerId: winner, reason: 'cracked' },
      moves: [],
      startedAt: Date.now() - 60_000,
      endedAt: Date.now(),
    });
    await recordMatch(duel(a)); // A streak 1
    await recordMatch(coopSession([a, b], 'detonated', ['coop_loss', 'coop_loss']));
    await recordMatch(duel(a)); // A streak 2: the co-op loss did not reset it
    await recordMatch(coopSession([a, b], 'defused', ['coop_win', 'coop_win']));
    const sa = (await UserModel.findById(a).lean())!.stats;
    expect(sa).toMatchObject({
      gamesPlayed: 2,
      wins: 2,
      losses: 0,
      draws: 0,
      currentStreak: 2,
      bestStreak: 2,
      coop: { played: 2, wins: 1, losses: 1, dropped: 0 },
    });
    const sb = (await UserModel.findById(b).lean())!.stats;
    expect(sb).toMatchObject({ gamesPlayed: 2, losses: 2, currentStreak: 0 });
  });
});

describe('co-op history', () => {
  it('shows teammates, roles and the co-op summary, and never the seed', async () => {
    const a = await env.telegramLogin({ id: 9301, first_name: 'Hist' });
    const b = await env.telegramLogin({ id: 9302, first_name: 'Ory' });
    const s = coopSession([a.user.id, b.user.id], 'defused', ['coop_win', 'coop_win']);
    await recordMatch(s);

    const mine = await env.http().get('/api/me/matches').set(auth(a.token)).expect(200);
    const row = mine.body.matches[0];
    expect(row).toMatchObject({
      gameType: 'defuser',
      outcome: 'coop_win',
      reason: 'defused',
      opponent: null,
      turns: 2,
      teammates: [{ userId: b.user.id, displayName: 'P2', role: 'analyst' }],
      coop: { role: 'operator', roleChange: null, panelsSolved: 3, faults: 1, msRemaining: 72_000 },
    });
    const profile = await env
      .http()
      .get(`/api/profile/${a.user.id}`)
      .set(auth(b.token))
      .expect(200);
    for (const body of [mine.body, profile.body]) {
      const json = JSON.stringify(body);
      expect(json).not.toContain(SEED);
      expect(json).not.toMatch(/generator|seed/i);
    }

    // The seed is stored, but excluded from every query unless explicitly selected.
    const plain = await MatchModel.findOne({ sessionId: s.sessionId }).lean();
    expect(plain).not.toHaveProperty('generator');
    const withSeed = await MatchModel.findOne({ sessionId: s.sessionId })
      .select('+generator')
      .lean();
    expect(withSeed!.generator).toEqual({ version: 1, seed: SEED });
  });

  it('duel history rows keep their shape, with no teammates and no co-op summary', async () => {
    const a = await env.telegramLogin({ id: 9401, first_name: 'Due' });
    const b = await env.telegramLogin({ id: 9402, first_name: 'Lin' });
    await recordMatch({
      sessionId: `duel-${Math.random().toString(36).slice(2)}`,
      roomId: 'room12345678',
      gameType: 'color-cipher',
      settings: { patternLength: 4, colorCount: 6, turnSeconds: 45, maxGuesses: 10 },
      isRematch: false,
      players: [
        { userId: a.user.id, displayName: 'A', photoUrl: null },
        { userId: b.user.id, displayName: 'B', photoUrl: null },
      ],
      result: { outcome: 'draw', winnerId: null, reason: 'both_cracked' },
      moves: [],
      startedAt: Date.now() - 60_000,
      endedAt: Date.now(),
    });
    const mine = await env.http().get('/api/me/matches').set(auth(a.token)).expect(200);
    expect(mine.body.matches[0]).toMatchObject({
      outcome: 'draw',
      opponent: { displayName: 'B' },
      teammates: [],
      coop: null,
    });
  });
});

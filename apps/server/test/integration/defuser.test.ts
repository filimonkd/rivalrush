import type { GameMove } from '@rivalrush/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefuser } from '../../src/games/defuser/game.js';
import type { DefuserState } from '../../src/games/defuser/state.js';
import type { SystemAction } from '../../src/games/engine/types.js';
import { recordMatch, type FinishedSession } from '../../src/matches/matchService.js';
import { MatchModel } from '../../src/matches/Match.model.js';
import { UserModel } from '../../src/users/User.model.js';
import { SEED, T0 } from '../helpers/defuser.js';
import { startTestServer, type TestEnv } from '../helpers/integration.js';

/**
 * A real Defuser game (the plug-in, not a hand-built session) recorded into a real MongoDB
 * replica set: drop-out, promotion, rejoin and a defuse, then stats and history.
 */
let env: TestEnv;
beforeAll(async () => {
  env = await startTestServer();
});
afterAll(async () => {
  await env?.stop();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Defuser match recording (real plug-in, real MongoDB)', () => {
  it('records roles, a promotion and a rejoin; updates only stats.coop; never exposes the seed', async () => {
    const users = await Promise.all(
      [9401, 9402, 9403].map((id, i) => env.telegramLogin({ id, first_name: `Crew${i}` })),
    );
    const ids = users.map((u) => u.user.id);
    const def = createDefuser({ fixedSeed: SEED });
    let s: DefuserState = def.createInitialState(
      { difficulty: 'normal' },
      { players: ids, firstPlayerIndex: 0, now: T0, random: Math.random },
    );
    const run = (by: string | SystemAction, action: unknown, now: number) => {
      const r = def.applyAction(
        s,
        typeof by === 'string' ? { kind: 'player', playerId: by } : { kind: 'system' },
        typeof by === 'string' ? action : by,
        { now, random: Math.random },
      );
      if (!r.ok) throw new Error(r.error.code);
      s = r.state;
    };
    const [op, a] = [ids[0]!, ids[1]!];
    for (const id of ids) run(id, { type: 'READY' }, T0 + 1000);
    run({ type: '$ABANDON', playerId: op }, null, T0 + 10_000); // a promoted
    run(op, { type: 'REJOIN' }, T0 + 20_000);
    const sol = s.edition.solution;
    run(a, { type: 'CUT_LINE', line: sol.fuse.line }, T0 + 30_000);
    run(a, { type: 'PRESS_GLYPH', key: sol.glyph.first }, T0 + 40_000);
    run(a, { type: 'PRESS_GLYPH', key: sol.glyph.second }, T0 + 50_000);
    run(a, { type: 'SET_VALVE', ...sol.valve }, T0 + 60_000);
    expect(s.phase).toBe('DEFUSED');

    const coop = def.getCoopPlayerRecords!(s);
    const session: FinishedSession = {
      sessionId: `defuser-${Math.random().toString(36).slice(2)}`,
      roomId: 'room12345678',
      gameType: 'defuser',
      settings: { difficulty: 'normal' },
      isRematch: false,
      players: users.map((u) => ({
        userId: u.user.id,
        displayName: u.user.displayName,
        photoUrl: null,
        coop: coop[u.user.id]!,
      })),
      result: def.getResult(s)!,
      moves: def.getMoves(s) as GameMove[],
      generator: def.getGeneratorInfo!(s)!,
      startedAt: T0,
      endedAt: T0 + 60_000,
    };
    expect(await recordMatch(session)).toBe('recorded');
    expect(await recordMatch(session)).toBe('duplicate');

    for (const id of ids) {
      const u = await UserModel.findById(id).lean();
      expect(u!.stats).toMatchObject({
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        currentStreak: 0,
        coop: { played: 1, wins: 1, losses: 0, dropped: 0 },
      });
    }

    const rows = await Promise.all(
      users.map(async (u) => {
        const res = await env.http().get('/api/me/matches').set(auth(u.token)).expect(200);
        const json = JSON.stringify(res.body);
        expect(json).not.toContain(SEED);
        expect(json).not.toMatch(/generator|seed/i);
        return res.body.matches[0];
      }),
    );
    expect(rows[0]).toMatchObject({
      outcome: 'coop_win',
      reason: 'defused',
      turns: 4,
      coop: { role: 'operator', roleChange: 'rejoined', panelsSolved: 3, faults: 0 },
    });
    expect(rows[1]).toMatchObject({ coop: { role: 'analyst', roleChange: 'promoted' } });
    expect(rows[2]).toMatchObject({ coop: { role: 'analyst', roleChange: null } });
    expect(rows[0].teammates).toHaveLength(2);

    const stored = await MatchModel.findOne({ sessionId: session.sessionId })
      .select('+generator')
      .lean();
    expect(stored!.generator).toEqual({ version: 1, seed: SEED });
    expect(stored!.moves).toHaveLength(7); // 4 inputs + timed_out, promoted, rejoined
  });
});

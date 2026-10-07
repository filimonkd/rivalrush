import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '@rivalrush/shared';
import type { Game } from '../helpers/defuser.js';
import { analysts, armAll, operator, ok, sol, start, T0, wrongLine } from '../helpers/defuser.js';

/**
 * The web app's Defuser tests render real role views: `apps/web/test/defuser/fixtures.json` holds
 * room snapshots whose views the plug-in built here (fixed seed, 2–4 players, every phase and view
 * kind). This test fails when the plug-in's views change, so the web fixtures cannot drift from the
 * server. Regenerate them with:
 *
 *   UPDATE_DEFUSER_WEB_FIXTURES=1 npx vitest run test/unit/defuser-web-fixtures.test.ts
 *
 * then run Prettier on the file.
 */
const FIXTURE = new URL('../../../web/test/defuser/fixtures.json', import.meta.url);

const NAMES: Record<string, string> = { p1: 'Ana', p2: 'Ben', p3: 'Cy', p4: 'Dee' };

function room(g: Game, viewer: string, extra: Partial<RoomSnapshot> = {}): RoomSnapshot {
  const view = g.def.getPlayerView(g.state, viewer);
  return {
    roomId: 'qaroom000001',
    inviteToken: 'qaqaqaqaqaqaqaqa',
    gameType: 'defuser',
    settings: { difficulty: 'normal' },
    status: g.state.result ? 'FINISHED' : 'IN_GAME',
    hostId: 'p1',
    maxPlayers: 4,
    players: g.state.players.map((p) => ({
      userId: p.id,
      displayName: NAMES[p.id]!,
      photoUrl: null,
      isHost: p.id === 'p1',
      ready: true,
      online: true,
      wantsRematch: false,
      graceDeadlineAt: null,
    })),
    version: 30,
    createdAt: 0,
    expiresAt: 0,
    serverTime: 0,
    game: {
      sessionId: 'qasession',
      gameType: 'defuser',
      version: g.state.version,
      view,
      result: g.state.result,
    },
    gamesPlayed: 0,
    ...extra,
  } as RoomSnapshot;
}

function build(): Record<string, RoomSnapshot> {
  const out: Record<string, RoomSnapshot> = {};
  const fresh = (n: number, first = 0) => start(n, { first });

  // Briefing
  let g = fresh(3);
  out['briefing-operator'] = room(g, operator(g));
  out['briefing-analyst'] = room(g, analysts(g)[0]!);
  g = fresh(4);
  out['briefing-analyst-4p'] = room(g, analysts(g)[1]!);

  // Armed, 3 players
  g = fresh(3);
  armAll(g);
  const op = operator(g);
  const [a, b] = analysts(g) as [string, string];
  out['operator-fuse'] = room(g, op);
  out['analyst-3p'] = room(g, a);
  out['analyst-3p-b'] = room(g, b);
  ok(g, op, { type: 'CUT_LINE', line: wrongLine(g) }, T0 + 5000);
  out['operator-1fault'] = room(g, op);
  ok(g, op, { type: 'PRESS_GLYPH', key: sol(g).glyph.first }, T0 + 6000);
  out['operator-glyph-lit'] = room(g, op);
  ok(g, op, { type: 'CUT_LINE', line: wrongLine(g) }, T0 + 7000);
  out['operator-2faults'] = room(g, op);
  ok(g, op, { type: 'CUT_LINE', line: sol(g).fuse.line }, T0 + 8000);
  out['operator-fuse-solved'] = room(g, op);
  out['analyst-solved-fuse'] = room(g, a);

  // 2 players: one Analyst holds all six
  g = fresh(2);
  armAll(g);
  out['analyst-2p'] = room(g, analysts(g)[0]!);
  out['operator-2p'] = room(g, operator(g));

  // 4 players
  g = fresh(4);
  armAll(g);
  out['analyst-4p'] = room(g, analysts(g)[0]!);

  // Timed-out Analyst and Operator
  g = fresh(3);
  armAll(g);
  const o3 = operator(g);
  const [x] = analysts(g) as [string];
  ok(g, { type: '$ABANDON', playerId: o3 }, null, T0 + 9000);
  out['inactive-operator'] = room(g, o3);
  out['promoted-operator'] = room(g, x);
  g = fresh(4);
  armAll(g);
  const [y] = analysts(g) as [string];
  ok(g, { type: '$ABANDON', playerId: y }, null, T0 + 9000);
  out['inactive-analyst'] = room(g, y);

  // Debriefs
  const finish = (how: 'defused' | 'faults' | 'timer' | 'abandoned') => {
    const gg = fresh(3);
    armAll(gg);
    const o = operator(gg);
    const s = sol(gg);
    if (how === 'defused') {
      ok(gg, o, { type: 'CUT_LINE', line: wrongLine(gg) }, T0 + 4000);
      ok(gg, o, { type: 'CUT_LINE', line: s.fuse.line }, T0 + 12000);
      ok(gg, o, { type: 'PRESS_GLYPH', key: s.glyph.first }, T0 + 20000);
      ok(gg, o, { type: 'PRESS_GLYPH', key: s.glyph.second }, T0 + 30000);
      ok(gg, o, { type: 'SET_VALVE', ...s.valve }, T0 + 80000);
    } else if (how === 'faults') {
      ok(gg, o, { type: 'CUT_LINE', line: wrongLine(gg) }, T0 + 4000);
      ok(gg, o, { type: 'CUT_LINE', line: wrongLine(gg) }, T0 + 6000);
      ok(gg, o, { type: 'CUT_LINE', line: wrongLine(gg) }, T0 + 8000);
    } else if (how === 'timer') {
      ok(gg, o, { type: 'CUT_LINE', line: s.fuse.line }, T0 + 9000);
      ok(gg, { type: '$TIMEOUT' }, null, gg.state.deadlineAt!);
    } else {
      const [p] = analysts(gg) as [string];
      ok(gg, { type: '$ABANDON', playerId: p }, null, T0 + 9000);
      const [q] = analysts(gg) as [string];
      ok(gg, { type: '$ABANDON', playerId: q }, null, T0 + 9500);
    }
    return gg;
  };
  for (const how of ['defused', 'faults', 'timer', 'abandoned'] as const) {
    const gg = finish(how);
    const viewer = gg.state.players.find((p) => p.status === 'active')!.id;
    out[`debrief-${how}`] = room(gg, viewer, {
      players: room(gg, viewer).players.map((p, i) => ({ ...p, wantsRematch: i === 1 })),
    });
  }
  return out;
}

describe('web Defuser fixtures', () => {
  if (process.env.UPDATE_DEFUSER_WEB_FIXTURES === '1') {
    it('writes the fixtures', () => {
      writeFileSync(FIXTURE, `${JSON.stringify(build(), null, 2)}\n`);
    });
    return;
  }

  it('match the views the plug-in builds today', () => {
    const stored = JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown;
    // Through JSON, as the client receives them (undefined fields drop out).
    expect(stored).toEqual(JSON.parse(JSON.stringify(build())));
  });
});

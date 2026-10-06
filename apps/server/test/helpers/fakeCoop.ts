import {
  coopIndividualResult,
  type CoopPlayerRecord,
  type CoopResult,
  type CoopTeamOutcome,
} from '@rivalrush/shared';
import type { GameDefinition } from '../../src/games/engine/types.js';

/**
 * A minimal co-op game for platform tests (rotation, roster snapshot, co-op recording). It is
 * NOT Defuser: just enough rules to start a 2–4 player game, drop players out and end it.
 */
export interface FakeCoopState {
  players: string[];
  operatorId: string;
  status: Record<string, 'active' | 'timed_out' | 'left'>;
  version: number;
  result: CoopResult | null;
}

type FakeAction = { type: 'END'; outcome: CoopTeamOutcome };

function end(s: FakeCoopState, outcome: CoopTeamOutcome): FakeCoopState {
  const individual = Object.fromEntries(
    s.players.map((p) => [p, coopIndividualResult(outcome, s.status[p] === 'active')]),
  );
  const reason =
    outcome === 'defused' ? 'defused' : outcome === 'detonated' ? 'faults' : 'abandoned';
  return {
    ...s,
    version: s.version + 1,
    result: {
      kind: 'coop',
      outcome,
      reason,
      panelsSolved: outcome === 'defused' ? 3 : 1,
      faults: outcome === 'detonated' ? 3 : 1,
      msRemaining: outcome === 'defused' ? 72_000 : 0,
      individual,
    },
  };
}

export const fakeCoop: GameDefinition<FakeCoopState, Record<string, never>, unknown, unknown> = {
  id: 'fake-coop',
  name: 'Fake co-op',
  minPlayers: 2,
  maxPlayers: 4,
  versionIndependentActions: ['END'],
  parseSettings: () => ({}),
  parseAction: (input) => {
    const a = input as Partial<FakeAction> | null;
    return a?.type === 'END' && ['defused', 'detonated', 'abandoned'].includes(a.outcome!)
      ? a
      : null;
  },
  createInitialState: (_settings, ctx) => ({
    players: [...ctx.players],
    operatorId: ctx.players[ctx.firstPlayerIndex]!,
    status: Object.fromEntries(ctx.players.map((p) => [p, 'active' as const])),
    version: 1,
    result: null,
  }),
  applyAction(state, _actor, action) {
    const a = action as
      FakeAction | { type: '$ABANDON' | '$FORFEIT'; playerId: string } | { type: '$TIMEOUT' };
    if (a.type === 'END') return { ok: true, state: end(state, a.outcome), events: [] };
    if (a.type === '$ABANDON' || a.type === '$FORFEIT') {
      if (state.status[a.playerId] !== 'active') {
        return { ok: false, error: { code: 'INVALID_ACTION', message: 'already inactive' } };
      }
      const status = {
        ...state.status,
        [a.playerId]: a.type === '$ABANDON' ? 'timed_out' : 'left',
      } as FakeCoopState['status'];
      const next = { ...state, status, version: state.version + 1 };
      const active = state.players.filter((p) => status[p] === 'active').length;
      return { ok: true, state: active < 2 ? end(next, 'abandoned') : next, events: [] };
    }
    return { ok: false, error: { code: 'INVALID_ACTION', message: 'unknown' } };
  },
  getPlayerView: (s) => ({ version: s.version }),
  getPublicView: (s) => ({ version: s.version }),
  getResult: (s) => s.result,
  getVersion: (s) => s.version,
  getNextDeadline: () => null,
  getMoves: () => [],
  getCoopPlayerRecords(s) {
    const out: Record<string, CoopPlayerRecord> = {};
    for (const p of s.players) {
      const role = p === s.operatorId ? 'operator' : 'analyst';
      out[p] = {
        startRole: role,
        finalRole: role,
        letter: null,
        finalStatus: s.status[p]!,
        rejoined: false,
      };
    }
    return out;
  },
  getGeneratorInfo: () => ({ version: 1, seed: '00112233445566778899aabbccddeeff' }),
};

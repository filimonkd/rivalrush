import { SHEET_IDS, type DefuserPlayerView } from '@rivalrush/shared';
import { describe, expect, it } from 'vitest';
import { createDefuser } from '../../src/games/defuser/game.js';
import { seedFromRandom } from '../../src/games/defuser/prng.js';
import type { GameEvent } from '../../src/games/engine/types.js';
import {
  T0,
  analysts,
  armAll,
  held,
  ok,
  operator,
  sol,
  start,
  wrongLine,
  type Game,
} from '../helpers/defuser.js';
import { seededRandom } from '../helpers/random.js';

/** Spec section 18: exactly these keys, so nothing else can ever be copied into a view. */
const SHARED = [
  'gameId',
  'phase',
  'version',
  'settings',
  'me',
  'editionLabel',
  'roster',
  'sheetIndex',
  'faults',
  'solved',
  'cutLines',
  'tried',
  'briefingDeadlineAt',
  'deadlineAt',
  'result',
];
const KEYS: Record<DefuserPlayerView['kind'], string[]> = {
  operator: [...SHARED, 'kind', 'charge', 'litKey'],
  analyst: [...SHARED, 'kind', 'sheets'],
  inactive: [...SHARED, 'kind', 'canRejoin', 'initialSheets'],
  debrief: [...SHARED, 'kind', 'charge', 'sheets', 'solution', 'moves'],
};
const sorted = (o: object) => Object.keys(o).sort();
const view = (g: Game, id: string) => g.def.getPlayerView(g.state, id);

/** Field names that exist ONLY inside the Charge, or only inside a sheet's rule data. */
const CHARGE_FIELDS = /"(lines|keys|balance|gauge|plate|style)"/;
const SHEET_FIELDS =
  /"(heat|rules|otherwise|frameValues|markValues|adjustment|adjustments|flip|grid|delta)"/;

/** Event payloads (section 10): exactly these data keys per type. */
const EVENT_DATA: Record<string, string[]> = {
  device_armed: ['deadlineAt'],
  panel_solved: ['panel', 'solvedCount'],
  fault: ['faults', 'input', 'panel'],
  role_changed: ['operatorId', 'previousOperatorId'],
  sheets_reassigned: ['moves', 'reason'],
  game_over: ['reason'],
};

function expectSafeEvent(e: GameEvent, g: Game): void {
  expect(sorted(e.data ?? {})).toEqual(EVENT_DATA[e.type]);
  const json = JSON.stringify(e);
  expect(json).not.toContain(g.state.seed);
  expect(json).not.toContain(g.state.edition.label);
  expect(json).not.toMatch(CHARGE_FIELDS);
  expect(json).not.toMatch(SHEET_FIELDS);
  if (e.type === 'fault') {
    const input = (e.data as { input: object }).input;
    expect(['["line"]', '["key"]', '["level","vent"]']).toContain(JSON.stringify(sorted(input)));
  }
}

describe('Defuser views (section 18)', () => {
  it('BRIEFING: roles, roster and index only; no Charge, no sheet contents', () => {
    const g = start(3);
    const op = view(g, operator(g));
    expect(op.kind).toBe('operator');
    expect(sorted(op)).toEqual([...KEYS.operator].sort());
    expect(op.kind === 'operator' && op.charge).toBeNull();
    for (const a of analysts(g)) {
      const v = view(g, a);
      expect(v.kind).toBe('analyst');
      expect(v.kind === 'analyst' && v.sheets).toEqual([]);
      expect(JSON.stringify(v)).not.toMatch(SHEET_FIELDS);
    }
    // The index lists every sheet with its holders: titles only.
    expect(op.sheetIndex.map((s) => s.sheet)).toEqual([...SHEET_IDS]);
  });

  it('ARMED: the Operator gets the Charge and no sheets; each Analyst only their own sheets', () => {
    const g = start(4);
    armAll(g);
    const op = view(g, operator(g));
    expect(sorted(op)).toEqual([...KEYS.operator].sort());
    expect(op.kind === 'operator' && op.charge).toEqual(g.state.edition.charge);
    expect(JSON.stringify(op)).not.toMatch(SHEET_FIELDS);
    for (const a of analysts(g)) {
      const v = view(g, a);
      expect(sorted(v)).toEqual([...KEYS.analyst].sort());
      expect(v.kind === 'analyst' && v.sheets.map((s) => s.id)).toEqual(held(g, a));
      expect(JSON.stringify(v)).not.toMatch(CHARGE_FIELDS);
    }
  });

  it('nobody sees the seed, the solution or the lit key except the Operator', () => {
    const g = start(3);
    armAll(g);
    ok(g, operator(g), { type: 'PRESS_GLYPH', key: sol(g).glyph.first }, T0 + 2000);
    for (const p of g.state.players) {
      const v = view(g, p.id);
      const json = JSON.stringify(v);
      expect(json).not.toContain(g.state.seed);
      expect(json).not.toMatch(/"solution"/);
      expect('litKey' in v).toBe(p.id === operator(g));
    }
  });

  it('a promoted player’s view drops their sheets and gains the Charge in the same version', () => {
    const g = start(3);
    armAll(g);
    const [a] = analysts(g) as [string];
    expect(view(g, a).kind).toBe('analyst');
    ok(g, { type: '$ABANDON', playerId: operator(g) }, null, T0 + 5000);
    const v = view(g, a);
    expect(v.kind).toBe('operator');
    expect(v.version).toBe(g.state.version);
    expect(sorted(v)).toEqual([...KEYS.operator].sort());
  });

  it('a timed-out player gets the Inactive view: no Charge, no sheets, canRejoin while ARMED', () => {
    const g = start(4);
    armAll(g);
    const op = operator(g);
    ok(g, { type: '$ABANDON', playerId: op }, null, T0 + 5000);
    const v = view(g, op);
    expect(sorted(v)).toEqual([...KEYS.inactive].sort());
    expect(v).toMatchObject({ kind: 'inactive', canRejoin: true });
    expect(v.kind === 'inactive' && v.initialSheets).toEqual(
      g.state.players.find((p) => p.id === op)!.rejoinSheets,
    );
    const json = JSON.stringify(v);
    expect(json).not.toMatch(CHARGE_FIELDS);
    expect(json).not.toMatch(SHEET_FIELDS);
    expect(v.roster.find((r) => r.userId === op)).toMatchObject({
      role: null,
      status: 'timed_out',
    });
  });

  it('after the end every seated member gets the debrief: Charge, all 6 sheets, solution, moves', () => {
    const g = start(2);
    armAll(g);
    for (let i = 0; i < 3; i++)
      ok(g, operator(g), { type: 'CUT_LINE', line: wrongLine(g) }, T0 + 9000 + i);
    for (const p of g.state.players) {
      const v = view(g, p.id);
      expect(sorted(v)).toEqual([...KEYS.debrief].sort());
      if (v.kind !== 'debrief') throw new Error('expected debrief');
      expect(v.sheets.map((s) => s.id)).toEqual([...SHEET_IDS]);
      expect(v.solution).toEqual(sol(g));
      expect(JSON.stringify(v)).not.toContain(g.state.seed);
    }
  });

  it('the public view has no viewer, no edition label and no secrets', () => {
    const g = start(3);
    armAll(g);
    const pub = g.def.getPublicView(g.state);
    expect(pub.kind).toBe('public');
    expect('me' in pub || 'editionLabel' in pub).toBe(false);
    const json = JSON.stringify(pub);
    expect(json).not.toMatch(CHARGE_FIELDS);
    expect(json).not.toMatch(SHEET_FIELDS);
  });
});

describe('Defuser secret isolation over many seeds', () => {
  const N = Number(process.env.DEFUSER_VIEW_SEEDS ?? 2000);

  it(
    `${N.toLocaleString('en')} random editions: views and events carry only what each role may know`,
    () => {
      const random = seededRandom(424242);
      for (let i = 0; i < N; i++) {
        const n = 2 + (i % 3);
        const def = createDefuser({ fixedSeed: seedFromRandom(random) });
        const g: Game = {
          def,
          state: def.createInitialState(
            { difficulty: 'normal' },
            {
              players: ['p1', 'p2', 'p3', 'p4'].slice(0, n),
              firstPlayerIndex: i % n,
              now: T0,
              random,
            },
          ),
        };
        const events: GameEvent[] = [];
        for (const p of g.state.players) events.push(...ok(g, p.id, { type: 'READY' }, T0 + 1));
        const op = operator(g);
        events.push(...ok(g, op, { type: 'CUT_LINE', line: wrongLine(g) }, T0 + 2));
        events.push(...ok(g, op, { type: 'PRESS_GLYPH', key: sol(g).glyph.first }, T0 + 3));
        if (n > 2) events.push(...ok(g, { type: '$ABANDON', playerId: op }, null, T0 + 4));

        for (const p of g.state.players) {
          const v = view(g, p.id);
          expect(sorted(v)).toEqual([...KEYS[v.kind]].sort());
          const json = JSON.stringify(v);
          expect(json).not.toContain(g.state.seed);
          expect(json).not.toMatch(/"solution"/);
          if (v.kind !== 'operator') expect(json).not.toMatch(CHARGE_FIELDS);
          if (v.kind !== 'analyst') expect(json).not.toMatch(SHEET_FIELDS);
          if (v.kind === 'analyst') {
            expect(v.sheets.map((s) => s.id)).toEqual(held(g, p.id));
          }
        }
        for (const e of events) expectSafeEvent(e, g);
      }
    },
    Math.max(30_000, N * 10),
  );
});

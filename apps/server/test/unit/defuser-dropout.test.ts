import { SHEET_IDS } from '@rivalrush/shared';
import { describe, expect, it } from 'vitest';
import {
  T0,
  analysts,
  armAll,
  expectEverySheetHeld,
  held,
  ok,
  operator,
  refused,
  start,
  types,
  type Game,
} from '../helpers/defuser.js';

const T = T0 + 5000;
const abandon = (g: Game, id: string, at = T) =>
  ok(g, { type: '$ABANDON', playerId: id }, null, at);
const leave = (g: Game, id: string, at = T) => ok(g, { type: '$FORFEIT', playerId: id }, null, at);
const player = (g: Game, id: string) => g.state.players.find((p) => p.id === id)!;

describe('Defuser drop-out: the scenarios of section 14', () => {
  it.each([
    ['Operator', 'timed out', true],
    ['Operator', 'left', true],
    ['Analyst', 'timed out', false],
    ['Analyst', 'left', false],
  ])('2 players, the %s %s → ABANDONED (scenarios 2–3)', (_, how, isOp) => {
    const g = start(2);
    armAll(g);
    const gone = isOp ? operator(g) : analysts(g)[0]!;
    const stay = isOp ? analysts(g)[0]! : operator(g);
    const ev = how === 'left' ? leave(g, gone) : abandon(g, gone);
    expect(ev).toEqual([{ type: 'game_over', actorId: null, data: { reason: 'abandoned' } }]);
    expect(g.state.phase).toBe('ABANDONED');
    expect(g.state.result!.individual).toEqual({
      [gone]: 'coop_dropped',
      [stay]: 'coop_unfinished',
    });
    expect(g.state.result!.outcome).toBe('abandoned');
  });

  it('3 players, the Operator drops: A is promoted and A’s 3 sheets go to B (scenario 4)', () => {
    const g = start(3);
    armAll(g);
    const op = operator(g);
    const [a, b] = analysts(g) as [string, string];
    const aSheets = held(g, a);
    const ev = abandon(g, op);
    expect(ev).toEqual([
      { type: 'role_changed', actorId: a, data: { operatorId: a, previousOperatorId: op } },
      {
        type: 'sheets_reassigned',
        actorId: null,
        data: { reason: 'drop_out', moves: aSheets.map((sheet) => ({ sheet, toPlayerId: b })) },
      },
    ]);
    expect(operator(g)).toBe(a);
    expect(held(g, a)).toEqual([]);
    expect(held(g, b)).toEqual([...SHEET_IDS]);
    expect(g.state.phase).toBe('ARMED');
  });

  it('3 players, Analyst A drops: A’s sheets go to B (scenario 5)', () => {
    const g = start(3);
    armAll(g);
    const [a, b] = analysts(g) as [string, string];
    expect(types(abandon(g, a))).toEqual(['sheets_reassigned']);
    expect(held(g, b)).toEqual([...SHEET_IDS]);
    expect(operator(g)).not.toBe(a);
  });

  it('3 players, two drop-outs in any order → ABANDONED on the second (scenario 6)', () => {
    for (const order of [
      [0, 1],
      [1, 0],
      [0, 2],
      [2, 0],
      [1, 2],
      [2, 1],
    ]) {
      const g = start(3);
      armAll(g);
      const ids = g.state.players.map((p) => p.id);
      abandon(g, ids[order[0]!]!);
      expect(g.state.phase).toBe('ARMED');
      expect(types(leave(g, ids[order[1]!]!))).toEqual(['game_over']);
      expect(g.state.phase).toBe('ABANDONED');
    }
  });

  it('4 players, the Operator drops: A’s 2 sheets split one to B, one to C (scenario 7)', () => {
    const g = start(4);
    armAll(g);
    const [a, b, c] = analysts(g) as [string, string, string];
    const [s1, s2] = held(g, a) as [string, string];
    const ev = abandon(g, operator(g));
    expect(ev[1]).toEqual({
      type: 'sheets_reassigned',
      actorId: null,
      data: {
        reason: 'drop_out',
        moves: [
          { sheet: s1, toPlayerId: b },
          { sheet: s2, toPlayerId: c },
        ],
      },
    });
    expect(held(g, b)).toHaveLength(3);
    expect(held(g, c)).toHaveLength(3);
  });

  it('4 players, one Analyst drops: their 2 sheets split by the fewest-sheets rule (scenario 8)', () => {
    const g = start(4);
    armAll(g);
    const [a, b, c] = analysts(g) as [string, string, string];
    abandon(g, b);
    expect(held(g, a)).toHaveLength(3);
    expect(held(g, c)).toHaveLength(3);
    expectEverySheetHeld(g);
  });

  it('4 players, two drop out (Operator among them): the last Analyst holds all 6 (scenario 9)', () => {
    const g = start(4);
    armAll(g);
    const [a, b, c] = analysts(g) as [string, string, string];
    abandon(g, operator(g));
    expect(operator(g)).toBe(a);
    leave(g, b);
    expect(held(g, c)).toEqual([...SHEET_IDS]);
    expect(g.state.phase).toBe('ARMED');
    // Scenario 10: a third drop-out → ABANDONED.
    expect(types(abandon(g, c))).toEqual(['game_over']);
  });

  it('a second $ABANDON (or $FORFEIT after a time-out) is refused with no change (scenarios 14–15)', () => {
    const g = start(3);
    armAll(g);
    const [a] = analysts(g) as [string];
    abandon(g, a);
    expect(refused(g, { type: '$ABANDON', playerId: a }, null, T + 1000)).toBe(
      'INVALID_ACTION/already_inactive',
    );
    expect(refused(g, { type: '$FORFEIT', playerId: a }, null, T + 2000)).toBe(
      'INVALID_ACTION/already_inactive',
    );
    // The first drop-out is the one recorded.
    expect(player(g, a).status).toBe('timed_out');
  });

  it('a Leave during BRIEFING arms the Charge if everyone remaining is ready (scenario 17)', () => {
    const g = start(4);
    const op = operator(g);
    const [a, b, c] = analysts(g) as [string, string, string];
    ok(g, a, { type: 'READY' }, T0 + 100);
    ok(g, b, { type: 'READY' }, T0 + 200);
    ok(g, c, { type: 'READY' }, T0 + 300);
    const ev = leave(g, op, T0 + 400);
    expect(types(ev)).toEqual(['role_changed', 'sheets_reassigned', 'device_armed']);
    expect(g.state.phase).toBe('ARMED');
    expect(g.state.armedAt).toBe(T0 + 400);
    // The countdown is still the 4-player one: fixed at game start.
    expect(g.state.deadlineAt).toBe(T0 + 400 + 300_000);
  });

  it('a drop-out with promotion and redistribution is exactly one version (+1)', () => {
    const g = start(4);
    armAll(g);
    const before = g.state.version;
    abandon(g, operator(g));
    expect(g.state.version).toBe(before + 1);
  });

  it('records drop-outs, promotions and rejoins as system moves (never as turns)', () => {
    const g = start(3);
    const at = armAll(g);
    const op = operator(g);
    const [a] = analysts(g) as [string];
    abandon(g, op, at + 10_000);
    ok(g, op, { type: 'REJOIN' }, at + 20_000);
    expect(g.state.moves).toEqual([
      { kind: 'system', playerId: op, event: 'timed_out', at: at + 10_000, atMs: 10_000 },
      { kind: 'system', playerId: a, event: 'promoted', at: at + 10_000, atMs: 10_000 },
      { kind: 'system', playerId: op, event: 'rejoined', at: at + 20_000, atMs: 20_000 },
    ]);
  });
});

describe('Defuser rejoin (section 14)', () => {
  it('an Analyst keeps their letter and gets copies of their initial sheets (scenario 11)', () => {
    const g = start(4);
    const at = armAll(g);
    const [a, b, c] = analysts(g) as [string, string, string];
    const initial = held(g, b);
    abandon(g, b, at + 1000);
    const ev = ok(g, b, { type: 'REJOIN' }, at + 2000);
    expect(ev).toEqual([
      {
        type: 'sheets_reassigned',
        actorId: b,
        data: { reason: 'rejoin', moves: initial.map((sheet) => ({ sheet, toPlayerId: b })) },
      },
    ]);
    expect(player(g, b)).toMatchObject({
      status: 'active',
      role: 'analyst',
      letter: 'B',
      rejoined: true,
    });
    expect(held(g, b)).toEqual(initial);
    // Copies are real holdings: those sheets now have two holders.
    for (const sheet of initial) expect(g.state.holders[sheet]).toHaveLength(2);
    expect(held(g, a).length + held(g, c).length).toBe(6);
  });

  it('a starting Operator rejoins as an Analyst with the next unused letter and their replacement’s sheets (scenario 12)', () => {
    for (const n of [3, 4]) {
      const g = start(n);
      const at = armAll(g);
      const op = operator(g);
      const [a] = analysts(g) as [string];
      const aInitial = held(g, a);
      abandon(g, op, at + 1000);
      ok(g, op, { type: 'REJOIN' }, at + 2000);
      expect(player(g, op)).toMatchObject({ role: 'analyst', letter: n === 3 ? 'C' : 'D' });
      expect(held(g, op)).toEqual(aInitial);
      expect(operator(g)).toBe(a);
      // Never Operator by rejoining; only by a later promotion.
      expect(refused(g, op, { type: 'CUT_LINE', line: 1 }, at + 3000)).toBe(
        'INVALID_ACTION/not_operator',
      );
    }
  });

  it('a starting Operator who dropped during BRIEFING rejoins with the promoted Analyst’s initial sheets', () => {
    const g = start(3);
    const op = operator(g);
    const [a] = analysts(g) as [string];
    const aInitial = held(g, a);
    abandon(g, op, T0 + 500);
    expect(refused(g, op, { type: 'REJOIN' }, T0 + 600)).toBe('GAME_NOT_STARTED');
    armAll(g, T0 + 700);
    ok(g, op, { type: 'REJOIN' }, T0 + 800);
    expect(held(g, op)).toEqual(aInitial);
  });

  it('a rejoined player can be promoted later, and can drop out again (scenario 13)', () => {
    const g = start(3);
    const at = armAll(g);
    const op = operator(g);
    const [a, b] = analysts(g) as [string, string];
    abandon(g, op, at + 1000); // A promoted
    ok(g, op, { type: 'REJOIN' }, at + 2000); // op is Analyst C
    abandon(g, a, at + 3000); // Operator A drops → earliest active letter is B
    expect(operator(g)).toBe(b);
    abandon(g, b, at + 4000); // B drops → C (the original Operator) promoted
    expect(g.state.phase).toBe('ABANDONED'); // only C is active: fewer than 2
    expect(g.state.result!.individual).toEqual({
      [op]: 'coop_unfinished',
      [a]: 'coop_dropped',
      [b]: 'coop_dropped',
    });
  });

  it('a rejoined player who drops again: sheets only they hold move, copies stay put', () => {
    const g = start(4);
    const at = armAll(g);
    const [, b, c] = analysts(g) as [string, string, string];
    const bInitial = held(g, b);
    abandon(g, b, at + 1000);
    ok(g, b, { type: 'REJOIN' }, at + 2000);
    abandon(g, c, at + 3000); // some of C's sheets may go to the rejoined B
    const before = structuredClone(g.state.holders);
    const ev = abandon(g, b, at + 4000);
    expectEverySheetHeld(g);
    const moved = ev.find((e) => e.type === 'sheets_reassigned');
    const movedSheets = (
      (moved?.data as { moves: Array<{ sheet: string }> } | undefined)?.moves ?? []
    ).map((m) => m.sheet);
    for (const sheet of SHEET_IDS) {
      const onlyB = before[sheet].length === 1 && before[sheet][0] === b;
      expect(movedSheets.includes(sheet), sheet).toBe(onlyB);
    }
    expect(bInitial.length).toBeGreaterThan(0);
  });

  it('a player who left can never rejoin (inactive); a rejoin needs ARMED', () => {
    const g = start(4);
    armAll(g);
    const [a] = analysts(g) as [string];
    leave(g, a);
    expect(refused(g, a, { type: 'REJOIN' }, T + 1000)).toBe('INVALID_ACTION/inactive');
  });
});

describe('Defuser drop-out: guarantee G6 over every drop-out sequence', () => {
  /** Every ordering of drop-outs (each a time-out or a Leave), in BRIEFING and in ARMED. */
  function* sequences(ids: string[]): Generator<Array<[string, 'timed_out' | 'left']>> {
    if (ids.length === 0) {
      yield [];
      return;
    }
    yield [];
    for (const id of ids) {
      for (const how of ['timed_out', 'left'] as const) {
        for (const rest of sequences(ids.filter((x) => x !== id))) yield [[id, how], ...rest];
      }
    }
  }

  it.each([2, 3, 4])('%i players: while 2+ are active, one Operator and every sheet held', (n) => {
    let checked = 0;
    for (const first of [0, n - 1]) {
      for (const armed of [false, true]) {
        const base = start(n, { first });
        if (armed) armAll(base);
        for (const seq of sequences(base.state.players.map((p) => p.id))) {
          const g: Game = { def: base.def, state: structuredClone(base.state) };
          for (const [id, how] of seq) {
            if (g.state.phase === 'ABANDONED') break;
            const r = g.def.applyAction(
              g.state,
              { kind: 'system' },
              { type: how === 'left' ? '$FORFEIT' : '$ABANDON', playerId: id },
              { now: T, random: Math.random },
            );
            expect(r.ok).toBe(true);
            if (!r.ok) break;
            expect(r.state.version).toBe(g.state.version + 1);
            g.state = r.state;
            const active = g.state.players.filter((p) => p.status === 'active');
            checked++;
            if (active.length < 2) {
              expect(g.state.phase).toBe('ABANDONED');
              break;
            }
            expect(active.filter((p) => p.role === 'operator').map((p) => p.id)).toEqual([
              g.state.operatorId,
            ]);
            expectEverySheetHeld(g);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

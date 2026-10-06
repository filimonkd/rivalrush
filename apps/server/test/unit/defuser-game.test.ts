import { DEFUSER_LIMITS, defuserCountdownSeconds } from '@rivalrush/shared';
import { describe, expect, it } from 'vitest';
import { createDefuser } from '../../src/games/defuser/game.js';
import { GENERATOR_VERSION, generateEdition } from '../../src/games/defuser/edition.js';
import {
  BRIEF_MS,
  PLAYERS,
  SEED,
  T0,
  analysts,
  apply,
  armAll,
  held,
  ok,
  operator,
  refused,
  sol,
  solutionOf,
  start,
  types,
  wrongLine,
} from '../helpers/defuser.js';

describe('Defuser: game creation', () => {
  it('seats the Operator and lettered Analysts in seat order after them, wrapping', () => {
    const g = start(4, { first: 2 });
    expect(g.state.players.map((p) => [p.id, p.role, p.letter])).toEqual([
      ['p1', 'analyst', 'B'],
      ['p2', 'analyst', 'C'],
      ['p3', 'operator', null],
      ['p4', 'analyst', 'A'],
    ]);
    expect(g.state.phase).toBe('BRIEFING');
    expect(g.state.version).toBe(1);
    expect(g.state.briefingDeadlineAt).toBe(T0 + BRIEF_MS);
    expect(g.state.deadlineAt).toBeNull();
  });

  it('gives each Analyst their initial sheets from the edition assignment', () => {
    for (const n of [2, 3, 4]) {
      const g = start(n, { first: 1 });
      const edition = generateEdition({ seed: SEED, analystCount: n - 1 });
      for (const id of analysts(g)) {
        const p = g.state.players.find((x) => x.id === id)!;
        const k = 'ABC'.indexOf(p.letter!);
        expect(held(g, id)).toEqual(edition.assignment[k]);
        expect(p.rejoinSheets).toEqual(edition.assignment[k]);
      }
      expect(held(g, operator(g))).toEqual([]);
    }
  });

  it('draws the seed with exactly three platform random() calls when no seed is fixed', () => {
    const def = createDefuser();
    let calls = 0;
    const state = def.createInitialState(
      { difficulty: 'normal' },
      {
        players: ['p1', 'p2'],
        firstPlayerIndex: 0,
        now: T0,
        random: () => {
          calls++;
          return 0.123456789;
        },
      },
    );
    expect(calls).toBe(3);
    expect(state.seed).toMatch(/^[0-9a-f]{32}$/);
    expect(def.getGeneratorInfo!(state)).toEqual({ version: GENERATOR_VERSION, seed: state.seed });
  });

  it('refuses a malformed fixed seed and 1 or 5 players', () => {
    expect(() => createDefuser({ fixedSeed: 'nope' })).toThrow(RangeError);
    const def = createDefuser({ fixedSeed: SEED });
    for (const n of [1, 5]) {
      expect(() =>
        def.createInitialState(
          { difficulty: 'normal' },
          {
            players: ['a', 'b', 'c', 'd', 'e'].slice(0, n),
            firstPlayerIndex: 0,
            now: T0,
            random: Math.random,
          },
        ),
      ).toThrow(/2–4 players/);
    }
  });

  it('accepts only the Normal difficulty and the five action shapes', () => {
    const def = createDefuser();
    expect(def.parseSettings({})).toEqual({ difficulty: 'normal' });
    expect(() => def.parseSettings({ difficulty: 'hard' })).toThrow();
    expect(def.parseAction({ type: 'CUT_LINE', line: 6 })).toBeNull();
    expect(def.parseAction({ type: 'PRESS_GLYPH', key: 0 })).toBeNull();
    expect(def.parseAction({ type: 'SET_VALVE', level: 3, vent: 'open' })).toBeNull();
    expect(def.parseAction({ type: 'READY', playerId: 'p2' })).toBeNull();
    expect(def.parseAction({ type: 'FORFEIT' })).toBeNull();
    expect(def.parseAction({ type: 'SET_VALVE', level: 3, vent: 'vent' })).toEqual({
      type: 'SET_VALVE',
      level: 3,
      vent: 'vent',
    });
    expect([...def.versionIndependentActions].sort()).toEqual([
      'CUT_LINE',
      'PRESS_GLYPH',
      'READY',
      'REJOIN',
      'SET_VALVE',
    ]);
  });
});

describe('Defuser: countdown (section 11)', () => {
  it.each([
    [2, 240],
    [3, 270],
    [4, 300],
  ])('%i players: %i s from arming, fixed by the Analysts at game start', (n, seconds) => {
    expect(defuserCountdownSeconds(n - 1)).toBe(seconds);
    const g = start(n);
    const at = armAll(g);
    expect(g.state.deadlineAt).toBe(at + seconds * 1000);
    // A drop-out doesn't change it.
    if (n > 2) {
      ok(g, { type: '$ABANDON', playerId: analysts(g)[0]! }, null, at + 5000);
      expect(g.state.deadlineAt).toBe(at + seconds * 1000);
    }
  });

  it('the briefing auto-arms at its deadline, and the countdown starts AT the deadline', () => {
    const g = start(3);
    ok(g, 'p2', { type: 'READY' }, T0 + 100);
    expect(refused(g, { type: '$TIMEOUT' }, null, T0 + BRIEF_MS - 1)).toBe('INVALID_ACTION');
    // A late timer (e.g. applied on the next action) still arms from the deadline itself.
    const ev = ok(g, { type: '$TIMEOUT' }, null, T0 + BRIEF_MS + 750);
    expect(ev).toEqual([
      { type: 'device_armed', actorId: null, data: { deadlineAt: T0 + BRIEF_MS + 270_000 } },
    ]);
    expect(g.state.armedAt).toBe(T0 + BRIEF_MS);
    expect(g.def.getNextDeadline(g.state)).toEqual({
      at: T0 + BRIEF_MS + 270_000,
      action: { type: '$TIMEOUT' },
    });
  });

  it('the countdown reaching 0 detonates with reason timer and 0 ms left', () => {
    const g = start(2);
    const at = armAll(g);
    const end = at + 240_000;
    expect(refused(g, { type: '$TIMEOUT' }, null, end - 1)).toBe('INVALID_ACTION');
    expect(types(ok(g, { type: '$TIMEOUT' }, null, end))).toEqual(['game_over']);
    expect(g.state.phase).toBe('DETONATED');
    expect(g.state.result).toMatchObject({
      kind: 'coop',
      outcome: 'detonated',
      reason: 'timer',
      msRemaining: 0,
      individual: { p1: 'coop_loss', p2: 'coop_loss' },
    });
    expect(g.def.getNextDeadline(g.state)).toBeNull();
  });
});

describe('Defuser: error precedence (section 9, steps 12–16)', () => {
  it('BRIEFING: device inputs and REJOIN → GAME_NOT_STARTED, whoever sends them', () => {
    const g = start(3);
    const [a] = analysts(g);
    expect(refused(g, a!, { type: 'CUT_LINE', line: 1 }, T0 + 1)).toBe('GAME_NOT_STARTED');
    expect(refused(g, operator(g), { type: 'PRESS_GLYPH', key: 1 }, T0 + 1)).toBe(
      'GAME_NOT_STARTED',
    );
    expect(refused(g, a!, { type: 'REJOIN' }, T0 + 1)).toBe('GAME_NOT_STARTED');
    ok(g, a!, { type: 'READY' }, T0 + 1);
    expect(refused(g, a!, { type: 'READY' }, T0 + 2)).toBe('INVALID_ACTION/already_ready');
  });

  it('a dropped player READY in BRIEFING → inactive', () => {
    const g = start(4);
    const [a] = analysts(g);
    ok(g, { type: '$ABANDON', playerId: a! }, null, T0 + 1);
    expect(refused(g, a!, { type: 'READY' }, T0 + 2)).toBe('INVALID_ACTION/inactive');
  });

  it('ARMED: READY → GAME_ALREADY_STARTED (even from an inactive player: phase is step 12)', () => {
    const g = start(3);
    armAll(g);
    const [a] = analysts(g);
    expect(refused(g, a!, { type: 'READY' }, T0 + 2000)).toBe('GAME_ALREADY_STARTED');
    ok(g, { type: '$ABANDON', playerId: a! }, null, T0 + 2000);
    expect(refused(g, a!, { type: 'READY' }, T0 + 3000)).toBe('GAME_ALREADY_STARTED');
  });

  it('ARMED: a timed-out ex-Operator cutting → inactive (status before role)', () => {
    const g = start(3);
    armAll(g);
    const op = operator(g);
    ok(g, { type: '$ABANDON', playerId: op }, null, T0 + 2000);
    expect(refused(g, op, { type: 'CUT_LINE', line: 1 }, T0 + 3000)).toBe(
      'INVALID_ACTION/inactive',
    );
  });

  it('ARMED: Analysts touching the Charge → not_operator; REJOIN when active → not_inactive', () => {
    const g = start(4);
    armAll(g);
    for (const a of analysts(g)) {
      expect(refused(g, a, { type: 'CUT_LINE', line: 1 }, T0 + 2000)).toBe(
        'INVALID_ACTION/not_operator',
      );
      expect(refused(g, a, { type: 'PRESS_GLYPH', key: 1 }, T0 + 2000)).toBe(
        'INVALID_ACTION/not_operator',
      );
      expect(refused(g, a, { type: 'SET_VALVE', level: 1, vent: 'seal' }, T0 + 2000)).toBe(
        'INVALID_ACTION/not_operator',
      );
      expect(refused(g, a, { type: 'REJOIN' }, T0 + 2000)).toBe('INVALID_ACTION/not_inactive');
    }
    expect(refused(g, operator(g), { type: 'REJOIN' }, T0 + 2000)).toBe(
      'INVALID_ACTION/not_inactive',
    );
  });

  it('a refusal never reveals the answer', () => {
    const g = start(2);
    armAll(g);
    const r = apply(g, analysts(g)[0]!, { type: 'CUT_LINE', line: sol(g).fuse.line }, T0 + 2000);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toBe('Only the Operator can do that.');
      expect(JSON.stringify(r.error)).not.toMatch(/line"?\s*:\s*\d|solution|answer/i);
    }
  });

  it('malformed payloads → INVALID_ACTION "Unknown move."; after the end → GAME_FINISHED', () => {
    const g = start(2);
    const r = g.def.applyAction(
      g.state,
      { kind: 'player', playerId: 'p1' },
      { type: 'CUT_LINE', line: 9 },
      { now: T0, random: Math.random },
    );
    expect(r.ok === false && r.error.code === 'INVALID_ACTION' && r.error.message).toBe(
      'Unknown move.',
    );
    ok(g, { type: '$FORFEIT', playerId: 'p2' }, null, T0 + 1);
    expect(g.state.phase).toBe('ABANDONED');
    for (const by of ['p1', 'p2']) {
      expect(refused(g, by, { type: 'READY' }, T0 + 2)).toBe('GAME_FINISHED');
      expect(refused(g, by, { type: 'REJOIN' }, T0 + 2)).toBe('GAME_FINISHED');
    }
    expect(refused(g, { type: '$TIMEOUT' }, null, T0 + 99_999_999)).toBe('GAME_FINISHED');
  });

  it('a player not in the game → NOT_ROOM_MEMBER', () => {
    const g = start(2);
    expect(refused(g, 'stranger', { type: 'READY' }, T0)).toBe('NOT_ROOM_MEMBER');
    expect(refused(g, { type: '$ABANDON', playerId: 'stranger' }, null, T0)).toBe(
      'NOT_ROOM_MEMBER',
    );
  });
});

describe('Defuser: transitions, events and versions (section 8)', () => {
  it('READY: snapshot only until everyone active is ready, then device_armed', () => {
    const g = start(3);
    expect(ok(g, 'p1', { type: 'READY' }, T0 + 10)).toEqual([]);
    expect(ok(g, 'p2', { type: 'READY' }, T0 + 20)).toEqual([]);
    expect(g.state.phase).toBe('BRIEFING');
    expect(ok(g, 'p3', { type: 'READY' }, T0 + 30)).toEqual([
      { type: 'device_armed', actorId: null, data: { deadlineAt: T0 + 30 + 270_000 } },
    ]);
    expect(g.state.armedAt).toBe(T0 + 30);
  });

  it('Fuse Lines: a wrong cut is a fault, stays cut, and the answer is unchanged', () => {
    const g = start(2);
    armAll(g);
    const op = operator(g);
    const wrong = wrongLine(g);
    expect(ok(g, op, { type: 'CUT_LINE', line: wrong }, T0 + 5000)).toEqual([
      { type: 'fault', actorId: op, data: { panel: 'fuse', faults: 1, input: { line: wrong } } },
    ]);
    expect(g.state.cutLines).toEqual([wrong]);
    expect(g.state.tried.fuse).toEqual([wrong]);
    expect(refused(g, op, { type: 'CUT_LINE', line: wrong }, T0 + 6000)).toBe(
      'INVALID_ACTION/line_cut',
    );
    const line = sol(g).fuse.line;
    expect(ok(g, op, { type: 'CUT_LINE', line }, T0 + 7000)).toEqual([
      { type: 'panel_solved', actorId: op, data: { panel: 'fuse', solvedCount: 1 } },
    ]);
    expect(g.state.cutLines).toEqual([wrong, line]);
    const other = [1, 2, 3, 4, 5].find((l) => !g.state.cutLines.includes(l))!;
    expect(refused(g, op, { type: 'CUT_LINE', line: other }, T0 + 8000)).toBe(
      'INVALID_ACTION/panel_solved',
    );
    expect(g.state.faults).toBe(1);
  });

  it('Glyph Ledger: first key lights (no event); a wrong second clears the entry', () => {
    const g = start(2);
    armAll(g);
    const op = operator(g);
    const { first, second } = sol(g).glyph;
    const wrongFirst = [1, 2, 3, 4].find((k) => k !== first)!;
    const wrongSecond = [1, 2, 3, 4].find((k) => k !== first && k !== second)!;

    expect(types(ok(g, op, { type: 'PRESS_GLYPH', key: wrongFirst }, T0 + 2000))).toEqual([
      'fault',
    ]);
    expect(g.state.litKey).toBeNull();
    expect(refused(g, op, { type: 'PRESS_GLYPH', key: wrongFirst }, T0 + 2100)).toBe(
      'INVALID_ACTION/already_tried',
    );

    expect(ok(g, op, { type: 'PRESS_GLYPH', key: first }, T0 + 3000)).toEqual([]);
    expect(g.state.litKey).toBe(first);
    expect(refused(g, op, { type: 'PRESS_GLYPH', key: first }, T0 + 3100)).toBe(
      'INVALID_ACTION/key_lit',
    );
    expect(ok(g, op, { type: 'PRESS_GLYPH', key: wrongSecond }, T0 + 4000)).toEqual([
      {
        type: 'fault',
        actorId: op,
        data: { panel: 'glyph', faults: 2, input: { key: wrongSecond } },
      },
    ]);
    expect(g.state.litKey).toBeNull();
    expect(g.state.tried.glyph).toEqual([
      { first: wrongFirst, second: null },
      { first, second: wrongSecond },
    ]);
    // The first key again: no fault for that; the known pair is refused.
    expect(ok(g, op, { type: 'PRESS_GLYPH', key: first }, T0 + 5000)).toEqual([]);
    expect(refused(g, op, { type: 'PRESS_GLYPH', key: wrongSecond }, T0 + 5100)).toBe(
      'INVALID_ACTION/already_tried',
    );
    expect(types(ok(g, op, { type: 'PRESS_GLYPH', key: second }, T0 + 6000))).toEqual([
      'panel_solved',
    ]);
    expect(g.state.faults).toBe(2);
  });

  it('Coolant Valve: a wrong pair is a fault and can never be committed again', () => {
    const g = start(2);
    armAll(g);
    const op = operator(g);
    const { level, vent } = sol(g).valve;
    const wrong = {
      type: 'SET_VALVE' as const,
      level,
      vent: vent === 'seal' ? ('vent' as const) : ('seal' as const),
    };
    expect(ok(g, op, wrong, T0 + 2000)).toEqual([
      {
        type: 'fault',
        actorId: op,
        data: { panel: 'valve', faults: 1, input: { level: wrong.level, vent: wrong.vent } },
      },
    ]);
    expect(refused(g, op, wrong, T0 + 3000)).toBe('INVALID_ACTION/already_tried');
    expect(types(ok(g, op, { type: 'SET_VALVE', level, vent }, T0 + 4000))).toEqual([
      'panel_solved',
    ]);
  });

  it('the third panel: panel_solved then game_over (defused), in one +1 transition', () => {
    const g = start(3);
    const at = armAll(g);
    const op = operator(g);
    const s = sol(g);
    ok(g, op, { type: 'CUT_LINE', line: wrongLine(g) }, at + 1000);
    ok(g, op, { type: 'CUT_LINE', line: s.fuse.line }, at + 2000);
    ok(g, op, { type: 'PRESS_GLYPH', key: s.glyph.first }, at + 3000);
    ok(g, op, { type: 'PRESS_GLYPH', key: s.glyph.second }, at + 4000);
    const ev = ok(g, op, { type: 'SET_VALVE', ...s.valve }, at + 60_000);
    expect(ev).toEqual([
      { type: 'panel_solved', actorId: op, data: { panel: 'valve', solvedCount: 3 } },
      { type: 'game_over', actorId: null, data: { reason: 'defused' } },
    ]);
    expect(g.state.phase).toBe('DEFUSED');
    expect(g.def.getResult(g.state)).toEqual({
      kind: 'coop',
      outcome: 'defused',
      reason: 'defused',
      panelsSolved: 3,
      faults: 1,
      msRemaining: 270_000 - 60_000,
      individual: { p1: 'coop_win', p2: 'coop_win', p3: 'coop_win' },
    });
    // Moves: accepted Operator inputs only (positions and levels), with times since arming.
    const moves = g.def.getMoves(g.state) as Array<{ kind: string; ok?: boolean; atMs: number }>;
    expect(moves.map((m) => [m.kind, m.ok, m.atMs])).toEqual([
      ['input', false, 1000],
      ['input', true, 2000],
      ['input', true, 3000],
      ['input', true, 4000],
      ['input', true, 60_000],
    ]);
  });

  it('the third fault: fault then game_over (faults), in one +1 transition', () => {
    const g = start(2);
    const at = armAll(g);
    const op = operator(g);
    ok(g, op, { type: 'CUT_LINE', line: wrongLine(g) }, at + 1000);
    ok(g, op, { type: 'CUT_LINE', line: wrongLine(g) }, at + 2000);
    const third = wrongLine(g);
    expect(ok(g, op, { type: 'CUT_LINE', line: third }, at + 3000)).toEqual([
      { type: 'fault', actorId: op, data: { panel: 'fuse', faults: 3, input: { line: third } } },
      { type: 'game_over', actorId: null, data: { reason: 'faults' } },
    ]);
    expect(g.state.result).toMatchObject({
      outcome: 'detonated',
      reason: 'faults',
      panelsSolved: 0,
      faults: DEFUSER_LIMITS.maxFaults,
      msRemaining: 240_000 - 3000,
    });
  });

  it('an input at or after the detonation deadline is refused (the platform applies $TIMEOUT first)', () => {
    const g = start(2);
    const at = armAll(g);
    expect(
      refused(g, operator(g), { type: 'CUT_LINE', line: sol(g).fuse.line }, at + 240_000),
    ).toBe('GAME_FINISHED');
  });

  it('records each player for match history', () => {
    const g = start(3, { first: 1 });
    expect(g.def.getCoopPlayerRecords!(g.state)).toEqual({
      p1: {
        startRole: 'analyst',
        finalRole: 'analyst',
        letter: 'B',
        finalStatus: 'active',
        rejoined: false,
      },
      p2: {
        startRole: 'operator',
        finalRole: 'operator',
        letter: null,
        finalStatus: 'active',
        rejoined: false,
      },
      p3: {
        startRole: 'analyst',
        finalRole: 'analyst',
        letter: 'A',
        finalStatus: 'active',
        rejoined: false,
      },
    });
  });

  it('solutionOf(seed) (test-only) agrees with the game', () => {
    for (const n of [2, 3, 4]) expect(sol(start(n))).toEqual(solutionOf(SEED, n - 1));
    expect(PLAYERS).toHaveLength(4);
  });
});

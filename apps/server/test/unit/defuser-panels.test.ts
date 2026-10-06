import { describe, expect, it } from 'vitest';
import {
  renderSheet,
  type ColorId,
  type FuseCharge,
  type FuseProcedure,
  type GlyphCharge,
  type GlyphProcedure,
  type ValveCharge,
  type ValveProcedure,
  type ValveReference,
} from '@rivalrush/shared';
import { safeFuse, solveFuse, verifyFuse } from '../../src/games/defuser/fuse.js';
import {
  GLYPH_SELECTOR_PAIRS,
  safeGlyph,
  solveGlyph,
  verifyGlyph,
} from '../../src/games/defuser/glyph.js';
import { Prng } from '../../src/games/defuser/prng.js';
import { safeValve, solveValve, verifyValve } from '../../src/games/defuser/valve.js';

// Color ids: Ruby 0, Amber 1, Sun 2, Leaf 3, Sky 4, Plum 5.
const [RUBY, AMBER, SUN, LEAF, SKY, PLUM] = [0, 1, 2, 3, 4, 5] as ColorId[];

/** The worked examples in docs/defuser.md section 5 are tests. */
describe('Fuse Lines: spec example edition', () => {
  const reference = { heat: [3, 6, 1, 5, 2, 4] }; // Ruby 3, Amber 6, Sun 1, Leaf 5, Sky 2, Plum 4
  const procedure: FuseProcedure = {
    rules: [
      {
        if: { kind: 'noColor', color: LEAF! },
        then: { kind: 'colorEnd', color: RUBY!, end: 'top' },
      },
      {
        if: { kind: 'dashedExactly', count: 3 },
        then: { kind: 'heat', which: 'lowest', group: 'dashed' },
      },
      {
        if: { kind: 'colorAbove', upper: RUBY!, lower: LEAF! },
        then: { kind: 'heat', which: 'highest', group: 'all' },
      },
      { if: { kind: 'colorAtLeastTwo', color: SKY! }, then: { kind: 'nthSolid', n: 2 } },
    ],
    otherwise: { kind: 'heat', which: 'lowest', group: 'all' },
  };
  const charge = (...spec: Array<[ColorId, 's' | 'd']>): FuseCharge => ({
    lines: spec.map(([color, st]) => ({ color, style: st === 'd' ? 'dashed' : 'solid' })),
  });

  it.each([
    [
      'A: rule 3 decides',
      charge([SKY!, 's'], [RUBY!, 'd'], [LEAF!, 's'], [RUBY!, 's'], [AMBER!, 'd']),
      5,
      2,
    ],
    [
      'B: rule 2 comes before the also-true rule 4',
      charge([PLUM!, 's'], [SKY!, 'd'], [LEAF!, 'd'], [SKY!, 's'], [AMBER!, 'd']),
      2,
      1,
    ],
    [
      'C: Otherwise decides',
      charge([RUBY!, 's'], [AMBER!, 's'], [LEAF!, 'd'], [PLUM!, 's'], [SUN!, 's']),
      5,
      4,
    ],
    [
      'D: equal Heat, the upper line counts',
      charge([SKY!, 's'], [PLUM!, 'd'], [LEAF!, 's'], [SUN!, 's'], [SUN!, 'd']),
      4,
      4,
    ],
  ])('%s', (_, c, line, decidingRule) => {
    expect(solveFuse(c, procedure, reference)).toMatchObject({ line, decidingRule });
  });

  it('E: rule 1 would fire with no Ruby line, so the panel is invalid', () => {
    const e = charge([PLUM!, 's'], [SUN!, 'd'], [SUN!, 's'], [SKY!, 's'], [PLUM!, 's']);
    expect(solveFuse(e, procedure, reference)).toBeNull();
    expect(verifyFuse({ charge: e, procedure, reference })).toContain('deciding action impossible');
  });

  it('a Heat action over one color does not need the Heat table (G4 counter-example)', () => {
    // Exactly one dashed line: "dashed line with the lowest Heat" is that line whatever the Heat.
    const c = charge([RUBY!, 'd'], [SUN!, 's'], [LEAF!, 's'], [SKY!, 's'], [PLUM!, 's']);
    const p: FuseProcedure = {
      rules: [
        {
          if: { kind: 'noColor', color: AMBER! },
          then: { kind: 'heat', which: 'lowest', group: 'dashed' },
        },
        ...procedure.rules.slice(1),
      ],
      otherwise: procedure.otherwise,
    };
    expect(solveFuse(c, p, reference)?.consulted).toEqual(['fuse.procedure']);
    expect(verifyFuse({ charge: c, procedure: p, reference })).toEqual(
      expect.arrayContaining(['rule 1 decides', 'heat table not needed']),
    );
  });

  it('renders the Ladder and Heat table exactly as the spec words them', () => {
    expect(renderSheet({ id: 'fuse.procedure', data: procedure }).items).toEqual([
      '1. If there is no Leaf ◆ bead, cut the Ruby ● line nearest the top.',
      '2. If exactly 3 lines are dashed, cut the dashed line with the lowest Heat.',
      '3. If a Ruby ● bead is directly above a Leaf ◆ bead, cut the line with the highest Heat.',
      '4. If two or more beads are Sky ★, cut the 2nd solid line from the top.',
      '5. Otherwise, cut the line with the lowest Heat.',
    ]);
    const ref = renderSheet({ id: 'fuse.reference', data: reference });
    expect(ref.title).toBe('Fuse Lines · Heat table');
    expect(ref.table!.rows).toEqual([
      ['Ruby ●', '3'],
      ['Amber ▲', '6'],
      ['Sun ■', '1'],
      ['Leaf ◆', '5'],
      ['Sky ★', '2'],
      ['Plum ✚', '4'],
    ]);
    expect(ref.note).toBe('Equal Heat: the upper line counts.');
  });
});

describe('Glyph Ledger: spec example edition', () => {
  // Frames Circle 0, Triangle 1, Square 2, Hexagon 3; marks Dot 0, Bar 1, Cross 2, Ring 3.
  const reference = { frameValues: [2, 5, 1, 4], markValues: [0, 3, 1, 2] };
  const procedure: GlyphProcedure = {
    adjustment: { kind: 'doubleMark', mark: 2 },
    first: 'closest',
    second: 'lowest',
  };
  const A: GlyphCharge = {
    balance: 7,
    keys: [
      { frame: 1, mark: 0 },
      { frame: 2, mark: 2 },
      { frame: 3, mark: 1 },
      { frame: 0, mark: 0 },
    ],
  };
  const B: GlyphCharge = {
    balance: 10,
    keys: [
      { frame: 3, mark: 2 },
      { frame: 1, mark: 3 },
      { frame: 0, mark: 0 },
      { frame: 2, mark: 3 },
    ],
  };

  it('A: press 3, then 4', () => {
    expect(solveGlyph(A, procedure, reference)).toMatchObject({ first: 3, second: 4 });
  });

  it('B: press 1, then 3; skipping the doubling would wrongly make key 2 closest', () => {
    expect(solveGlyph(B, procedure, reference)).toMatchObject({ first: 1, second: 3 });
    const withoutDoubling = { ...procedure, adjustment: { kind: 'doubleMark', mark: 0 } as const };
    expect(solveGlyph(B, withoutDoubling, reference)?.first).not.toBe(1);
  });

  it('renders Entry order and Value tables', () => {
    expect(renderSheet({ id: 'glyph.procedure', data: procedure }).items).toEqual([
      '1. Double the value of any key whose mark is a Cross.',
      '2. First key: the key whose value is closest to the Balance.',
      '3. Second key: the key with the lowest value.',
    ]);
    const r = renderSheet({ id: 'glyph.reference', data: reference });
    expect(r.table!.header).toEqual(['Frame', 'Value', 'Mark', 'Value']);
    expect(r.table!.rows[0]).toEqual(['Circle', '2', 'Dot', '0']);
  });

  it('only selector pairs that can name two different keys are allowed', () => {
    expect(GLYPH_SELECTOR_PAIRS).toHaveLength(10);
    for (const [a, b] of GLYPH_SELECTOR_PAIRS) {
      expect(a).not.toBe(b);
      expect([a, b].sort().join()).not.toBe('closest,equals');
    }
  });

  it('a Balance outside 1–25 is rejected', () => {
    expect(verifyGlyph({ charge: { ...A, balance: 26 }, procedure, reference })).toContain(
      'balance range',
    );
    expect(verifyGlyph({ charge: { ...A, balance: 0 }, procedure, reference })).toContain(
      'balance range',
    );
  });
});

describe('Coolant Valve: spec example edition (corrected rules)', () => {
  const cell = (s: string) => ({
    level: Number(s[0]),
    vent: s[1] === 'V' ? ('vent' as const) : ('seal' as const),
  });
  // Plates Ruby 0, Sun 1, Leaf 2, Sky 3; columns Off, Steady, Pulsing.
  const reference: ValveReference = {
    grid: [
      ['2S', '4V', '1S'],
      ['3V', '1S', '5V'],
      ['1V', '3S', '4S'],
      ['5S', '2V', '3S'],
    ].map((row) => row.map(cell)),
  };
  const procedure: ValveProcedure = {
    adjustments: [
      { from: 60, to: 99, delta: -1 },
      { from: 0, to: 24, delta: 2 },
    ],
    flip: { kind: 'levelEven' },
  };
  const at = (plate: 0 | 1 | 2 | 3, lamp: ValveCharge['lamp'], gauge: number): ValveCharge => ({
    plate,
    lamp,
    gauge,
  });

  it.each([
    ['A', at(3, 'steady', 72), 1, 'vent'],
    ['B', at(2, 'steady', 41), 3, 'seal'],
    ['C', at(0, 'off', 9), 4, 'vent'],
  ])('%s', (_, charge, level, vent) => {
    expect(solveValve(charge, procedure, reference)).toMatchObject({ level, vent });
  });

  it('D: a level outside 1–5 is never clamped: the panel is invalid', () => {
    const charge = at(1, 'pulsing', 12);
    expect(solveValve(charge, procedure, reference)).toBeNull();
    expect(verifyValve({ charge, procedure, reference })).toContain('level outside 1–5');
  });

  it('renders Adjustments and the Level grid', () => {
    expect(renderSheet({ id: 'valve.procedure', data: procedure }).items).toEqual([
      '1. Gauge 60–99: lower one level.',
      '2. Gauge 00–24: raise two levels.',
      '3. Flip the vent if the final level is even.',
    ]);
    const r = renderSheet({ id: 'valve.reference', data: reference });
    expect(r.title).toBe('Coolant Valve · Level grid');
    expect(r.table!.header).toEqual(['Plate', 'Off', 'Steady', 'Pulsing']);
    expect(r.table!.rows[3]).toEqual(['Sky ★', '5·S', '2·V', '3·S']);
    expect(r.note).toBe('S = Seal, V = Vent.');
  });
});

describe('safe templates are valid by construction', () => {
  it('for 2,000 PRNG states each', () => {
    const p = new Prng('a1b2c3d4e5f60718293a4b5c6d7e8f90');
    for (let i = 0; i < 2000; i++) {
      expect(verifyFuse(safeFuse(p))).toEqual([]);
      expect(verifyGlyph(safeGlyph(p))).toEqual([]);
      expect(verifyValve(safeValve(p))).toEqual([]);
    }
  });
});

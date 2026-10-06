import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  GLYPH_BALANCE,
  GLYPH_VALUE,
  SHEET_IDS,
  VALVE_LAMPS,
  renderSheet,
  type SheetId,
} from '@rivalrush/shared';
import {
  MAX_ATTEMPTS,
  generateEdition,
  sheetData,
  sheetSizeProblems,
  type Edition,
} from '../../src/games/defuser/edition.js';
import { solveFuse } from '../../src/games/defuser/fuse.js';
import { glyphValues, solveGlyph } from '../../src/games/defuser/glyph.js';
import { solveValve } from '../../src/games/defuser/valve.js';
import {
  oracleFuseAnswers,
  oracleGlyphAnswers,
  oracleValveAnswers,
} from '../helpers/defuserOracle.js';
import { parseSheet } from '../helpers/defuserSheetParser.js';

/**
 * Generator property tests (docs/defuser.md sections 6–7, guarantees G1–G6).
 *
 * Seed count: DEFUSER_SEEDS (default 5,000 in the PR suite; the full verification suite runs
 * 100,000 via `npm run test:defuser:full`). Each seed is generated for 1, 2 and 3 Analysts in
 * turn, and every check below runs on every generated edition.
 */
const N = Number(process.env.DEFUSER_SEEDS ?? 5_000);
/** Per-test time budget, scaled with the seed count (the full suite runs 20× the PR suite). */
const T = Math.max(30_000, N * 3);
const seedOf = (i: number) =>
  createHash('sha256').update(`defuser-${i}`).digest('hex').slice(0, 32);

let editions: Edition[];
beforeAll(() => {
  editions = Array.from({ length: N }, (_, i) =>
    generateEdition({ seed: seedOf(i), analystCount: 1 + (i % 3) }),
  );
}, 600_000);

/** Every ordering of a short list (lazily, so a search can stop at the first hit). */
function* permutations<T>(xs: readonly T[]): Generator<T[]> {
  if (xs.length <= 1) {
    yield [...xs];
    return;
  }
  for (let i = 0; i < xs.length; i++) {
    for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)]))
      yield [xs[i]!, ...rest];
  }
}

const sheetsOf = (e: Edition) => SHEET_IDS.map((id) => sheetData(e, id));
/** What an Analyst actually receives: plain JSON, no shared object identity. */
const received = (e: Edition, id: SheetId) => JSON.parse(JSON.stringify(sheetData(e, id).data));

describe(`Defuser generator over ${N} seeds`, () => {
  it(
    'G1: every panel has exactly one correct input (enumerated by the independent oracle)',
    () => {
      for (const e of editions) {
        const f = e.fuse.panel;
        const g = e.glyph.panel;
        const v = e.valve.panel;
        expect(oracleFuseAnswers(f.charge, f.procedure, f.reference)).toEqual([
          e.solution.fuse.line,
        ]);
        expect(oracleGlyphAnswers(g.charge, g.procedure, g.reference)).toEqual([e.solution.glyph]);
        expect(oracleValveAnswers(v.charge, v.procedure, v.reference)).toEqual([e.solution.valve]);
      }
    },
    T,
  );

  it(
    'G2: the Charge plus the six sheets as received always give the solution',
    () => {
      for (const e of editions) {
        const c = JSON.parse(JSON.stringify(e.charge));
        expect(
          solveFuse(c.fuse, received(e, 'fuse.procedure'), received(e, 'fuse.reference'))?.line,
        ).toBe(e.solution.fuse.line);
        const g = solveGlyph(
          c.glyph,
          received(e, 'glyph.procedure'),
          received(e, 'glyph.reference'),
        );
        expect({ first: g?.first, second: g?.second }).toEqual(e.solution.glyph);
        const v = solveValve(
          c.valve,
          received(e, 'valve.procedure'),
          received(e, 'valve.reference'),
        );
        expect({ level: v?.level, vent: v?.vent }).toEqual(e.solution.valve);
      }
    },
    T,
  );

  it(
    'G3: rendered wording reads back to exactly the rule data (unambiguous, deterministic)',
    () => {
      for (const e of editions) {
        for (const sheet of sheetsOf(e)) {
          const r = renderSheet(sheet);
          expect(renderSheet(sheet)).toEqual(r);
          expect(parseSheet(r)).toEqual(JSON.parse(JSON.stringify(sheet)));
        }
      }
    },
    T,
  );

  it(
    'G4: both sheets of every panel are genuinely needed (changing either changes the answer)',
    () => {
      for (const e of editions) {
        // Fuse. Reference: reversing Heat swaps highest and lowest, which moves the answer
        // whenever the deciding group has 2+ colors. Procedure: flipping the deciding direction.
        const f = e.fuse.panel;
        const rev = { heat: f.reference.heat.map((h) => 7 - h) };
        expect(solveFuse(f.charge, f.procedure, rev)?.line).not.toBe(e.solution.fuse.line);
        const s = solveFuse(f.charge, f.procedure, f.reference)!;
        const swap = structuredClone(f.procedure);
        const act =
          s.decidingRule < swap.rules.length ? swap.rules[s.decidingRule]!.then : swap.otherwise;
        if (act.kind === 'heat') act.which = act.which === 'highest' ? 'lowest' : 'highest';
        expect(solveFuse(f.charge, swap, f.reference)?.line).not.toBe(e.solution.fuse.line);

        // Glyph. Procedure: swapping the selectors swaps the keys. Reference: some other value
        // table (all 4-permutations of the frame values tried) changes the answer.
        const g = e.glyph.panel;
        const swapped = { ...g.procedure, first: g.procedure.second, second: g.procedure.first };
        const sw = solveGlyph(g.charge, swapped, g.reference);
        expect(
          sw && sw.first === e.solution.glyph.first && sw.second === e.solution.glyph.second,
        ).toBeFalsy();
        let changed = false;
        for (const frameValues of permutations(g.reference.frameValues)) {
          for (const markValues of permutations(g.reference.markValues)) {
            const a = solveGlyph(g.charge, g.procedure, { frameValues, markValues });
            if (!a || a.first !== e.solution.glyph.first || a.second !== e.solution.glyph.second) {
              changed = true;
              break;
            }
          }
          if (changed) break;
        }
        expect(changed).toBe(true);

        // Valve. Reference: flipping the used cell's vent mark. Procedure: a flip rule that
        // applies exactly when the current one doesn't.
        const v = e.valve.panel;
        const ref2 = structuredClone(v.reference);
        const cell = ref2.grid[v.charge.plate]![VALVE_LAMPS.indexOf(v.charge.lamp)]!;
        cell.vent = cell.vent === 'vent' ? 'seal' : 'vent';
        expect(solveValve(v.charge, v.procedure, ref2)?.vent).not.toBe(e.solution.valve.vent);
        const g0 = v.charge.gauge;
        const inverse = { from: g0 <= 79 ? g0 : g0 - 19, to: g0 <= 79 ? g0 + 19 : g0 };
        const away = g0 >= 50 ? { from: 0, to: 19 } : { from: 80, to: 99 };
        const now = solveValve(v.charge, v.procedure, v.reference)!;
        const cellVent =
          v.reference.grid[v.charge.plate]![VALVE_LAMPS.indexOf(v.charge.lamp)]!.vent;
        const flipsNow = now.vent !== cellVent;
        const proc2 = {
          ...v.procedure,
          flip: { kind: 'gaugeIn' as const, ...(flipsNow ? away : inverse) },
        };
        expect(solveValve(v.charge, proc2, v.reference)?.vent).not.toBe(e.solution.valve.vent);
      }
    },
    T,
  );

  it(
    'G5: the initial assignment splits every panel across two Analysts (2+ Analysts)',
    () => {
      for (const e of editions) {
        const flat = e.assignment.flat();
        expect([...flat].sort()).toEqual([...SHEET_IDS].sort()); // every sheet exactly once
        expect(e.assignment.map((a) => a.length)).toEqual(
          { 1: [6], 2: [3, 3], 3: [2, 2, 2] }[e.analystCount as 1 | 2 | 3],
        );
        if (e.analystCount >= 2) {
          for (const sheets of e.assignment) {
            const panels = sheets.map((s) => s.split('.')[0]);
            expect(new Set(panels).size).toBe(panels.length);
          }
        }
        if (e.analystCount === 3) {
          // Ring: every pair of Analysts shares exactly one panel.
          const panelsOf = e.assignment.map((a) => new Set(a.map((s) => s.split('.')[0])));
          for (const [x, y] of [
            [0, 1],
            [1, 2],
            [0, 2],
          ] as const) {
            expect([...panelsOf[x]!].filter((p) => panelsOf[y]!.has(p))).toHaveLength(1);
          }
        }
      }
    },
    T,
  );

  it(
    'G6: every supported team size generates valid editions (no safe template needed)',
    () => {
      const maxAttempts = { fuse: 0, glyph: 0, valve: 0 };
      for (const e of editions) {
        expect([1, 2, 3]).toContain(e.analystCount);
        for (const k of ['fuse', 'glyph', 'valve'] as const) {
          expect(e[k].usedSafeTemplate).toBe(false);
          maxAttempts[k] = Math.max(maxAttempts[k], e[k].attempts);
        }
      }
      // Fuse and Valve are valid by construction on the first draw; Glyph retries on ties.
      expect(maxAttempts.fuse).toBe(1);
      expect(maxAttempts.valve).toBe(1);
      expect(maxAttempts.glyph).toBeLessThan(MAX_ATTEMPTS);
    },
    T,
  );

  it(
    'sheet size limits hold; values, Balance and levels stay in range; no ties',
    () => {
      for (const e of editions) {
        for (const sheet of sheetsOf(e)) expect(sheetSizeProblems(sheet)).toEqual([]);
        const g = e.glyph.panel;
        const values = glyphValues(g.charge.keys, g.reference, g.procedure.adjustment);
        for (const v of values) {
          expect(v).toBeGreaterThanOrEqual(GLYPH_VALUE.min);
          expect(v).toBeLessThanOrEqual(GLYPH_VALUE.max);
        }
        expect(g.charge.balance).toBeGreaterThanOrEqual(GLYPH_BALANCE.min);
        expect(g.charge.balance).toBeLessThanOrEqual(GLYPH_BALANCE.max);
        expect(e.solution.valve.level).toBeGreaterThanOrEqual(1);
        expect(e.solution.valve.level).toBeLessThanOrEqual(5);
        expect(e.solution.glyph.first).not.toBe(e.solution.glyph.second);
      }
    },
    T,
  );

  it(
    'duplicate bead colors appear and are handled by the tie rule',
    () => {
      const withDupes = editions.filter(
        (e) => new Set(e.charge.fuse.lines.map((l) => l.color)).size < 5,
      );
      expect(withDupes.length).toBeGreaterThan(N / 2);
    },
    T,
  );
});

/** Pearson chi-square statistic for a contingency table of counts. */
function chiSquare(table: number[][]): number {
  const rows = table.map((r) => r.reduce((a, b) => a + b, 0));
  const cols = table[0]!.map((_, j) => table.reduce((a, r) => a + r[j]!, 0));
  const total = rows.reduce((a, b) => a + b, 0);
  let x2 = 0;
  table.forEach((r, i) =>
    r.forEach((o, j) => {
      const exp = (rows[i]! * cols[j]!) / total;
      if (exp > 0) x2 += (o - exp) ** 2 / exp;
    }),
  );
  return x2;
}

describe(`Defuser distribution targets over ${N} seeds`, () => {
  it(
    'Fuse: rules 2, 3, 4 and Otherwise each decide about 25% (target)',
    () => {
      const counts = [0, 0, 0, 0, 0];
      for (const e of editions) {
        const f = e.fuse.panel;
        counts[solveFuse(f.charge, f.procedure, f.reference)!.decidingRule]!++;
      }
      expect(counts[0]).toBe(0);
      for (const c of counts.slice(1)) expect(Math.abs(c / N - 0.25)).toBeLessThan(0.03);
    },
    T,
  );

  it(
    'Glyph: ignoring the adjustment changes the answer in at least half of editions (target)',
    () => {
      let differs = 0;
      for (const e of editions) {
        const g = e.glyph.panel;
        const r = g.reference;
        const base = g.charge.keys.map((k) => r.frameValues[k.frame]! + r.markValues[k.mark]!);
        const pick = (sel: string) => {
          const score = (v: number) =>
            sel === 'highest'
              ? v
              : sel === 'lowest'
                ? -v
                : sel === 'closest'
                  ? -Math.abs(v - g.charge.balance)
                  : v === g.charge.balance
                    ? 1
                    : 0;
          const best = Math.max(...base.map(score));
          const hits = base.flatMap((v, i) => (score(v) === best ? [i + 1] : []));
          return hits.length === 1 ? hits[0] : null;
        };
        if (
          pick(g.procedure.first) !== e.solution.glyph.first ||
          pick(g.procedure.second) !== e.solution.glyph.second
        ) {
          differs++;
        }
      }
      expect(differs / N).toBeGreaterThanOrEqual(0.5);
    },
    T,
  );

  it(
    'Valve: an adjustment applies in about 60% of editions (target)',
    () => {
      const applied = editions.filter((e) => {
        const v = e.valve.panel;
        return solveValve(v.charge, v.procedure, v.reference)!.adjusted;
      }).length;
      expect(Math.abs(applied / N - 0.6)).toBeLessThan(0.04);
    },
    T,
  );

  it(
    'Valve: the answer is uniform and independent of everything the Operator sees (chi-square)',
    () => {
      const levelByLamp = [0, 1, 2, 3, 4].map(() => [0, 0, 0]);
      const ventByLamp = [0, 1].map(() => [0, 0, 0]);
      const levelByGauge = [0, 1, 2, 3, 4].map(() => [0, 0, 0, 0, 0]);
      const levelByPlate = [0, 1, 2, 3, 4].map(() => [0, 0, 0, 0]);
      const levels = [0, 0, 0, 0, 0];
      for (const e of editions) {
        const { level, vent } = e.solution.valve;
        const { lamp, gauge, plate } = e.charge.valve;
        const li = VALVE_LAMPS.indexOf(lamp);
        levelByLamp[level - 1]![li]!++;
        ventByLamp[vent === 'vent' ? 1 : 0]![li]!++;
        levelByGauge[level - 1]![Math.min(4, Math.floor(gauge / 20))]!++;
        levelByPlate[level - 1]![plate]!++;
        levels[level - 1]!++;
      }
      // Critical values at α = 0.001: df 8 → 26.12, df 2 → 13.82, df 16 → 39.25, df 12 → 32.91.
      expect(chiSquare(levelByLamp)).toBeLessThan(26.12);
      expect(chiSquare(ventByLamp)).toBeLessThan(13.82);
      expect(chiSquare(levelByGauge)).toBeLessThan(39.25);
      expect(chiSquare(levelByPlate)).toBeLessThan(32.91);
      for (const c of levels) expect(Math.abs(c / N - 0.2)).toBeLessThan(0.03);
    },
    T,
  );
});

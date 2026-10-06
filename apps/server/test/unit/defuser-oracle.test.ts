import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ColorId } from '@rivalrush/shared';
import { generateFuse, solveFuse } from '../../src/games/defuser/fuse.js';
import { generateGlyph, solveGlyph } from '../../src/games/defuser/glyph.js';
import { Prng } from '../../src/games/defuser/prng.js';
import { generateValve, solveValve } from '../../src/games/defuser/valve.js';
import {
  oracleFuseAnswers,
  oracleGlyphAnswers,
  oracleValveAnswers,
} from '../helpers/defuserOracle.js';

/**
 * The production solver and the independent oracle must agree on ARBITRARY panels: raw,
 * unverified generator draws plus random mutations, including invalid ones. Where the solver
 * finds an answer the oracle must find exactly that one; where the solver refuses (a tie or an
 * impossible action), the oracle must not find exactly one answer either.
 */
const SAMPLES = Number(process.env.DEFUSER_ORACLE_SAMPLES ?? 20_000);
const T = Math.max(30_000, SAMPLES / 2);

describe('independent oracle', () => {
  it(
    'does not import the production generator or solver',
    () => {
      const src = readFileSync(new URL('../helpers/defuserOracle.ts', import.meta.url), 'utf8');
      expect(src).not.toMatch(/from ['"][^'"]*games\/defuser/);
      expect(src).not.toMatch(/import\(/);
    },
    T,
  );

  it(
    `agrees with the Fuse solver on ${SAMPLES} arbitrary panels`,
    () => {
      const p = new Prng('0badc0de0badc0de0badc0de0badc0de');
      let solved = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const panel = generateFuse(p);
        // Mutate: recolor a line and restyle another, so many panels become invalid.
        panel.charge.lines[p.int(5)]!.color = p.int(6) as ColorId;
        const line = panel.charge.lines[p.int(5)]!;
        if (p.int(2)) line.style = line.style === 'solid' ? 'dashed' : 'solid';
        const s = solveFuse(panel.charge, panel.procedure, panel.reference);
        const o = oracleFuseAnswers(panel.charge, panel.procedure, panel.reference);
        if (s) {
          solved++;
          expect(o).toEqual([s.line]);
        } else expect(o).toEqual([]);
      }
      expect(solved).toBeGreaterThan(SAMPLES / 2);
    },
    T,
  );

  it(
    `agrees with the Glyph solver on ${SAMPLES} arbitrary panels`,
    () => {
      const p = new Prng('feedfacefeedfacefeedfacefeedface');
      let solved = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const panel = generateGlyph(p);
        if (p.int(2)) panel.charge.balance = p.range(1, 25);
        if (p.int(4) === 0) panel.procedure.second = panel.procedure.first; // always invalid
        const s = solveGlyph(panel.charge, panel.procedure, panel.reference);
        const o = oracleGlyphAnswers(panel.charge, panel.procedure, panel.reference);
        if (s) {
          solved++;
          expect(o).toEqual([{ first: s.first, second: s.second }]);
        } else expect(o).toEqual([]);
      }
      expect(solved).toBeGreaterThan(SAMPLES / 4);
    },
    T,
  );

  it(
    `agrees with the Valve solver on ${SAMPLES} arbitrary panels`,
    () => {
      const p = new Prng('c0ffeec0ffeec0ffeec0ffeec0ffee00');
      let solved = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const panel = generateValve(p);
        panel.charge.gauge = p.range(0, 99);
        const cell = panel.reference.grid[p.int(4)]![p.int(3)]!;
        cell.level = p.range(1, 5);
        const s = solveValve(panel.charge, panel.procedure, panel.reference);
        const o = oracleValveAnswers(panel.charge, panel.procedure, panel.reference);
        if (s) {
          solved++;
          expect(o).toEqual([{ level: s.level, vent: s.vent }]);
        } else expect(o).toEqual([]);
      }
      expect(solved).toBeGreaterThan(SAMPLES / 2);
    },
    T,
  );
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateEdition } from '../../src/games/defuser/edition.js';

/**
 * The Playwright Defuser specs run the real server with `DEFUSER_FIXED_SEED` and play the answers
 * pinned in `apps/web/e2e/defuser-seed.json`. This test fails if the generator would deal a
 * different edition for that seed, so the E2E answers cannot drift from the server.
 */
const pinned = JSON.parse(
  readFileSync(new URL('../../../web/e2e/defuser-seed.json', import.meta.url), 'utf8'),
) as {
  seed: string;
  editionLabel: string;
  solution: unknown;
  wrongLines: number[];
};

describe('the E2E fixed seed', () => {
  it.each([1, 2, 3])('deals the pinned edition for %i Analyst(s)', (analystCount) => {
    const e = generateEdition({ seed: pinned.seed, analystCount });
    expect(e.solution).toEqual(pinned.solution);
    expect(e.label).toBe(pinned.editionLabel);
  });

  it('lists every wrong Fuse line', () => {
    const e = generateEdition({ seed: pinned.seed, analystCount: 1 });
    const lines = e.charge.fuse.lines.map((_, i) => i + 1);
    expect(pinned.wrongLines).toEqual(lines.filter((l) => l !== e.solution.fuse.line));
  });
});

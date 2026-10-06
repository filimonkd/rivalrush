import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GENERATOR_VERSION,
  generateEdition,
  type Edition,
} from '../../src/games/defuser/edition.js';

/**
 * Golden seeds: 20 fixed seeds and the exact editions they produce. If generation changes,
 * this fails. That is the point: decide whether the change is intended, then bump
 * GENERATOR_VERSION (src/games/defuser/edition.ts), regenerate with
 *   UPDATE_DEFUSER_GOLDEN=1 npx vitest run test/unit/defuser-golden.test.ts
 * and say why in the commit. Old match records keep their version, so a reported game can be
 * regenerated with the generator it was made by.
 */
const FIXTURE = new URL('../fixtures/defuser-golden.json', import.meta.url);

interface Golden {
  generatorVersion: number;
  editions: Array<{ seed: string; analystCount: number; edition: Edition }>;
}

const SEEDS = Array.from({ length: 20 }, (_, i) => ({
  seed: (BigInt(i + 1) * 0x9e3779b97f4a7c15n).toString(16).padStart(32, '0').slice(-32),
  analystCount: 1 + (i % 3),
}));

function current(): Golden {
  return {
    generatorVersion: GENERATOR_VERSION,
    editions: SEEDS.map(({ seed, analystCount }) => ({
      seed,
      analystCount,
      edition: generateEdition({ seed, analystCount }),
    })),
  };
}

describe('Defuser golden seeds', () => {
  if (process.env.UPDATE_DEFUSER_GOLDEN === '1') {
    it('writes the golden fixture', () => {
      const dir = new URL('../fixtures/', import.meta.url);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(current(), null, 2)}\n`);
    });
    return;
  }

  it('the fixture was made by the current generator version', () => {
    const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Golden;
    expect(
      golden.generatorVersion,
      'Generator output changed meaning: bump GENERATOR_VERSION and regenerate the fixture',
    ).toBe(GENERATOR_VERSION);
  });

  it('20 fixed seeds still produce exactly the same editions', () => {
    const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Golden;
    expect(golden.editions).toHaveLength(20);
    const now = current();
    for (let i = 0; i < golden.editions.length; i++) {
      expect(
        now.editions[i],
        `seed ${golden.editions[i]!.seed} changed: if intended, bump GENERATOR_VERSION and regenerate`,
      ).toEqual(golden.editions[i]);
    }
  });
});

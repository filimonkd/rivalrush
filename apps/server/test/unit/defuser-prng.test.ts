import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prng, editionLabel, isSeed, seedFromRandom } from '../../src/games/defuser/prng.js';
import { generateEdition } from '../../src/games/defuser/edition.js';

const SEED = '0123456789abcdef0123456789abcdef';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Defuser PRNG (xoshiro128**)', () => {
  it('matches an independent reference implementation (known-answer vector)', () => {
    // Computed with a separate Python implementation of xoshiro128**.
    const p = new Prng(SEED);
    expect(Array.from({ length: 8 }, () => p.nextU32())).toEqual([
      2576975000, 2576975000, 857404821, 967348376, 2501596056, 2275814263, 973530828, 33043070,
    ]);
  });

  it('same seed → same sequence; different seed → different sequence', () => {
    const run = (seed: string) => {
      const p = new Prng(seed);
      return Array.from({ length: 50 }, () => p.int(1000));
    };
    expect(run(SEED)).toEqual(run(SEED));
    expect(run(SEED)).not.toEqual(run('fedcba9876543210fedcba9876543210'));
  });

  it('int, range, pick, shuffle and sample stay in bounds and are unbiased enough', () => {
    const p = new Prng(SEED);
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60_000; i++) counts[p.int(6)]!++;
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(400);
    for (let i = 0; i < 1000; i++) {
      const r = p.range(3, 7);
      expect(r).toBeGreaterThanOrEqual(3);
      expect(r).toBeLessThanOrEqual(7);
    }
    expect(p.shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
    const s = p.sample([1, 2, 3, 4, 5, 6], 4);
    expect(new Set(s).size).toBe(4);
    expect(() => p.int(0)).toThrow(RangeError);
  });

  it('never gets stuck in the all-zero state', () => {
    const p = new Prng('0'.repeat(32));
    expect(new Set(Array.from({ length: 20 }, () => p.nextU32())).size).toBeGreaterThan(15);
  });

  it('rejects malformed seeds', () => {
    expect(isSeed(SEED)).toBe(true);
    for (const bad of ['', 'xyz', SEED.toUpperCase(), `${SEED}0`, SEED.slice(1)]) {
      expect(isSeed(bad)).toBe(false);
      expect(() => new Prng(bad)).toThrow(RangeError);
    }
  });
});

describe('seed from the platform random source', () => {
  it('uses exactly three calls of 47 bits each, truncated to 128 bits', () => {
    const values = [1, 2, 3].map((k) => k / 2 ** 47);
    const random = vi.fn(() => values.shift()!);
    // Bits 1, 2, 3 at 47-bit offsets, top 13 bits dropped (independently computed).
    expect(seedFromRandom(random)).toBe('00000000400000000001000000000003');
    expect(random).toHaveBeenCalledTimes(3);
  });

  it('always yields a valid 32-hex seed and refuses out-of-range randoms', () => {
    expect(isSeed(seedFromRandom(() => 0))).toBe(true);
    expect(isSeed(seedFromRandom(() => 1 - 2 ** -47))).toBe(true);
    expect(() => seedFromRandom(() => 1)).toThrow(RangeError);
    expect(() => seedFromRandom(() => Number.NaN)).toThrow(RangeError);
  });
});

describe('no hidden entropy', () => {
  it('generation does not depend on the clock or Math.random', () => {
    const mathRandom = vi.spyOn(Math, 'random');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const a = generateEdition({ seed: SEED, analystCount: 2 });
    vi.setSystemTime(new Date('2031-06-15T12:34:56Z'));
    const b = generateEdition({ seed: SEED, analystCount: 2 });
    expect(b).toEqual(a);
    expect(mathRandom).not.toHaveBeenCalled();
  });
});

describe('edition label', () => {
  it('is 3 characters from an unambiguous alphabet, deterministic per seed', () => {
    expect(editionLabel(SEED)).toMatch(/^[2-9A-HJ-NP-Z]{3}$/);
    expect(editionLabel(SEED)).toBe(editionLabel(SEED));
    const labels = new Set(
      Array.from({ length: 500 }, (_, i) => editionLabel(i.toString(16).padStart(32, '0'))),
    );
    expect(labels.size).toBeGreaterThan(400);
  });
});

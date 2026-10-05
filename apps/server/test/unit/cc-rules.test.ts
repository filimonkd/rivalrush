import { checkPattern } from '@rivalrush/shared';
import { describe, expect, it } from 'vitest';
import { generatePattern, scorePattern } from '../../src/games/color-cipher/rules.js';
import { seededRandom } from '../helpers/random.js';

/** Letters used in docs/color-cipher.md → color ids. */
const ID: Record<string, string> = { R: '0', A: '1', S: '2', L: '3', K: '4', P: '5' };
const enc = (letters: string) =>
  letters
    .split(' ')
    .map((l) => ID[l])
    .join('');

// The 16 worked examples from docs/color-cipher.md, verbatim.
const EXAMPLES: Array<[string, string, number, number]> = [
  ['R K L S', 'R L S K', 1, 3],
  ['R R L K', 'R R R R', 2, 0],
  ['R R L K', 'L R R R', 1, 2],
  ['R L K S', 'R R R R', 1, 0],
  ['R R R R', 'R L K S', 1, 0],
  ['R R L L', 'L L R R', 0, 4],
  ['R L R L', 'L R L R', 0, 4],
  ['R R L K', 'K R R L', 1, 3],
  ['S S S K', 'K S S S', 2, 2],
  ['R L K P', 'A A S S', 0, 0],
  ['R R K K', 'R K R K', 2, 2],
  ['R L L L', 'L L L R', 2, 2],
  ['R L K S', 'R L K S', 4, 0],
  ['P P A K', 'P K P A', 1, 3],
  ['R R R L', 'L L L R', 0, 2],
  ['S S K K', 'S K S K', 2, 2],
];

/** Independent reference: mark exact matches, then match each remaining guess tile once. */
function reference(secret: string, guess: string) {
  const s = secret.split('');
  const g = guess.split('');
  let exact = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === g[i]) {
      exact++;
      s[i] = '#';
      g[i] = '*';
    }
  }
  let partial = 0;
  for (let i = 0; i < g.length; i++) {
    const j = s.indexOf(g[i]!);
    if (j >= 0) {
      partial++;
      s[j] = '#';
    }
  }
  return { exact, partial };
}

describe('Color Cipher scoring', () => {
  it.each(EXAMPLES)('secret %s, guess %s → %i exact, %i close', (secret, guess, exact, partial) => {
    expect(scorePattern(enc(secret), enc(guess))).toEqual({ exact, partial });
  });

  it('exact match, partial match and miss in one guess', () => {
    // Secret R A S L, guess R S P P: R exact, S close, P P miss.
    expect(scorePattern('0123', '0255')).toEqual({ exact: 1, partial: 1 });
  });

  it('agrees with an independent scorer on all 1,296 × sampled guesses', () => {
    const rnd = seededRandom(3);
    for (let i = 0; i < 1296; i++) {
      const secret = i.toString(6).padStart(4, '0');
      for (let k = 0; k < 8; k++) {
        const guess = generatePattern(4, 6, rnd);
        expect(scorePattern(secret, guess)).toEqual(reference(secret, guess));
      }
    }
  });

  it('is symmetric in its totals and bounded by the length', () => {
    const rnd = seededRandom(9);
    for (let i = 0; i < 500; i++) {
      const a = generatePattern(4, 6, rnd);
      const b = generatePattern(4, 6, rnd);
      const ab = scorePattern(a, b);
      const ba = scorePattern(b, a);
      expect(ab.exact).toBe(ba.exact);
      expect(ab.exact + ab.partial).toBe(ba.exact + ba.partial);
      expect(ab.exact + ab.partial).toBeLessThanOrEqual(4);
    }
  });

  it('refuses patterns of different lengths', () => {
    expect(() => scorePattern('012', '0123')).toThrow(/length/);
  });
});

describe('Color Cipher patterns', () => {
  it('generated patterns are valid, use the whole palette and can repeat colors', () => {
    const rnd = seededRandom(5);
    const seen = new Set<string>();
    let repeats = 0;
    for (let i = 0; i < 300; i++) {
      const p = generatePattern(4, 6, rnd);
      expect(checkPattern(p, 4, 6)).toBe('ok');
      for (const c of p) seen.add(c);
      if (new Set(p).size < 4) repeats++;
    }
    expect([...seen].sort().join('')).toBe('012345');
    expect(repeats).toBeGreaterThan(0);
  });

  it('checkPattern: length and palette', () => {
    expect(checkPattern('0123')).toBe('ok');
    expect(checkPattern('0000')).toBe('ok');
    expect(checkPattern('5555')).toBe('ok');
    expect(checkPattern('012')).toBe('length');
    expect(checkPattern('01234')).toBe('length');
    expect(checkPattern('0126')).toBe('color');
    expect(checkPattern('9999')).toBe('color');
  });
});

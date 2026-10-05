import { describe, expect, it } from 'vitest';
import { generateSecret, score } from '../../src/games/crack-the-code/rules.js';
import { seededRandom } from '../helpers/random.js';

describe('Crack the Code scoring', () => {
  it('matches the worked example from the spec (5831 vs 5813 → 2 bulls, 2 cows)', () => {
    expect(score('5831', '5813')).toEqual({ bulls: 2, cows: 2 });
  });

  it('scores an exact match as all bulls', () => {
    expect(score('0123', '0123')).toEqual({ bulls: 4, cows: 0 });
  });

  it('scores no overlap as zero', () => {
    expect(score('0123', '4567')).toEqual({ bulls: 0, cows: 0 });
  });

  it('scores a full permutation as all cows', () => {
    expect(score('1234', '4321')).toEqual({ bulls: 0, cows: 4 });
  });

  it('counts each secret digit at most once even if a guess repeats digits', () => {
    expect(score('1234', '1111')).toEqual({ bulls: 1, cows: 0 });
    expect(score('1234', '2222')).toEqual({ bulls: 1, cows: 0 });
    expect(score('1234', '5511')).toEqual({ bulls: 0, cows: 1 });
  });

  it('works for 3 and 5 digit codes', () => {
    expect(score('012', '210')).toEqual({ bulls: 1, cows: 2 });
    expect(score('98765', '98756')).toEqual({ bulls: 3, cows: 2 });
  });

  it('rejects mismatched lengths', () => {
    expect(() => score('123', '1234')).toThrow();
  });
});

describe('generateSecret', () => {
  it('always produces unique digits of the requested length (leading zero allowed)', () => {
    const random = seededRandom(42);
    let sawLeadingZero = false;
    for (let i = 0; i < 500; i++) {
      for (const len of [3, 4, 5]) {
        const code = generateSecret(len, random);
        expect(code).toMatch(new RegExp(`^[0-9]{${len}}$`));
        expect(new Set(code).size).toBe(len);
        if (code.startsWith('0')) sawLeadingZero = true;
      }
    }
    expect(sawLeadingZero).toBe(true);
  });
});

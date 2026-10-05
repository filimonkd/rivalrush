/** Pure scoring and pattern rules for Color Cipher (see docs/color-cipher.md). */

export interface Feedback {
  /** Right color, right position. */
  exact: number;
  /** Right color, wrong position. */
  partial: number;
}

/**
 * Exact = positions where the colors match. Close (partial) = for every color, the smaller of
 * its counts in the secret and the guess, summed, minus the exact matches. Every secret tile is
 * matched at most once and an exact match is never also counted as close, so repeated colors
 * are handled deterministically.
 */
export function scorePattern(secret: string, guess: string): Feedback {
  if (secret.length !== guess.length) throw new Error('scorePattern: length mismatch');
  let exact = 0;
  const inSecret: Record<string, number> = {};
  const inGuess: Record<string, number> = {};
  for (let i = 0; i < secret.length; i++) {
    const s = secret[i]!;
    const g = guess[i]!;
    if (s === g) exact++;
    inSecret[s] = (inSecret[s] ?? 0) + 1;
    inGuess[g] = (inGuess[g] ?? 0) + 1;
  }
  let common = 0;
  for (const [color, n] of Object.entries(inSecret)) common += Math.min(n, inGuess[color] ?? 0);
  return { exact, partial: common - exact };
}

/** Random pattern: each position any color, repeats allowed. */
export function generatePattern(length: number, colorCount: number, random: () => number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String(Math.floor(random() * colorCount));
  return out;
}

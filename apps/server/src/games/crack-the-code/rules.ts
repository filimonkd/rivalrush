/** Pure scoring and code rules for Crack the Code. */

export interface Score {
  bulls: number;
  cows: number;
}

/**
 * Bull = right digit in the right place. Cow = right digit in the wrong place.
 * Codes have unique digits, but scoring is written to be correct for repeats too
 * (each secret digit can be matched at most once).
 */
export function score(secret: string, guess: string): Score {
  if (secret.length !== guess.length) throw new Error('score: length mismatch');
  let bulls = 0;
  const secretRest: Record<string, number> = {};
  const guessRest: string[] = [];
  for (let i = 0; i < secret.length; i++) {
    const s = secret[i]!;
    const g = guess[i]!;
    if (s === g) bulls++;
    else {
      secretRest[s] = (secretRest[s] ?? 0) + 1;
      guessRest.push(g);
    }
  }
  let cows = 0;
  for (const g of guessRest) {
    const left = secretRest[g] ?? 0;
    if (left > 0) {
      cows++;
      secretRest[g] = left - 1;
    }
  }
  return { bulls, cows };
}

/** Random valid secret: unique digits, leading zero allowed. */
export function generateSecret(length: number, random: () => number): string {
  const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  // Fisher–Yates on the first `length` positions.
  for (let i = 0; i < length; i++) {
    const j = i + Math.floor(random() * (digits.length - i));
    [digits[i], digits[j]] = [digits[j]!, digits[i]!];
  }
  return digits.slice(0, length).join('');
}

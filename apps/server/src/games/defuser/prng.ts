/**
 * Defuser's deterministic random source (docs/defuser.md section 6).
 *
 * The only entropy comes from the platform's injected `random()` (CSPRNG-backed in
 * production): three calls give 3 × 47 = 141 bits, truncated to a 128-bit seed. From then on
 * every draw comes from xoshiro128** seeded with those 128 bits. No Date, no Math.random, no
 * further `random()` calls, so the same seed always reproduces the same edition.
 */

export const SEED_HEX_LENGTH = 32;
const SEED_RE = /^[0-9a-f]{32}$/;

export function isSeed(seed: string): boolean {
  return SEED_RE.test(seed);
}

/** Draws a 128-bit seed (32 lowercase hex chars) from the platform's random source. */
export function seedFromRandom(random: () => number): string {
  let bits = 0n;
  for (let i = 0; i < 3; i++) {
    const r = random();
    if (!(r >= 0 && r < 1)) throw new RangeError('random() must return a number in [0, 1)');
    bits = (bits << 47n) | BigInt(Math.floor(r * 2 ** 47));
  }
  bits &= (1n << 128n) - 1n;
  return bits.toString(16).padStart(SEED_HEX_LENGTH, '0');
}

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

/** xoshiro128** (Blackman & Vigna), 32-bit outputs. */
export class Prng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: string) {
    if (!isSeed(seed)) throw new RangeError('seed must be 32 lowercase hex characters');
    const word = (i: number) => parseInt(seed.slice(i * 8, i * 8 + 8), 16) >>> 0;
    this.s0 = word(0);
    this.s1 = word(1);
    this.s2 = word(2);
    this.s3 = word(3);
    // The all-zero state is the one state xoshiro can't leave.
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 0x9e3779b9;
  }

  /** Next uniform 32-bit unsigned integer. */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform integer in [0, n), without modulo bias. */
  int(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new RangeError(`bad bound ${n}`);
    const limit = 2 ** 32 - (2 ** 32 % n);
    for (;;) {
      const r = this.nextU32();
      if (r < limit) return r % n;
    }
  }

  /** Uniform integer in [min, max], inclusive. */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }

  /** A shuffled copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /** `k` distinct items, in random order. */
  sample<T>(items: readonly T[], k: number): T[] {
    return this.shuffle(items).slice(0, k);
  }
}

const LABEL_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * The on-screen edition label ("4K7"): 3 characters of a hash of the seed (FNV-1a), so the
 * label reveals at most 15 bits and nothing that reproduces the seed.
 */
export function editionLabel(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 3; i++) out += LABEL_ALPHABET[(h >>> (i * 5)) & 31];
  return out;
}

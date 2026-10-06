import {
  GLYPH_BALANCE,
  GLYPH_KEY_COUNT,
  GLYPH_VALUE,
  type FrameId,
  type Glyph,
  type GlyphAdjustment,
  type GlyphCharge,
  type GlyphProcedure,
  type GlyphReference,
  type GlyphSelector,
  type MarkId,
  type SheetId,
} from '@rivalrush/shared';
import type { Prng } from './prng.js';

/** Glyph Ledger (docs/defuser.md 5.2): a Charge plus its two sheets. */
export interface GlyphPanel {
  charge: GlyphCharge;
  procedure: GlyphProcedure;
  reference: GlyphReference;
}

export interface GlyphSolution {
  /** 1-based keys, pressed in this order. */
  first: number;
  second: number;
  consulted: SheetId[];
}

/**
 * Selector pairs that can pick two different keys. Identical selectors, and "closest" with
 * "equals" (the equal key is always the closest one), always pick the same key.
 */
export const GLYPH_SELECTOR_PAIRS: ReadonlyArray<readonly [GlyphSelector, GlyphSelector]> = (
  ['highest', 'lowest', 'closest', 'equals'] as const
).flatMap((a) =>
  (['highest', 'lowest', 'closest', 'equals'] as const)
    .filter(
      (b) =>
        a !== b && !(a === 'closest' && b === 'equals') && !(a === 'equals' && b === 'closest'),
    )
    .map((b) => [a, b] as const),
);

// ---------------------------------------------------------------- rules → meaning

/** Key values after the adjustment: base = frame value + mark value (1–11), adjusted 1–22. */
export function glyphValues(
  keys: readonly Glyph[],
  ref: GlyphReference,
  adjustment: GlyphAdjustment,
): number[] {
  return keys.map((k, i) => {
    const base = ref.frameValues[k.frame]! + ref.markValues[k.mark]!;
    switch (adjustment.kind) {
      case 'doubleMark':
        return k.mark === adjustment.mark ? base * 2 : base;
      case 'addOuter':
        return i === 0 || i === keys.length - 1 ? base + adjustment.amount : base;
      case 'addSharedFrame':
        return keys.some((o, j) => j !== i && o.frame === k.frame)
          ? base + adjustment.amount
          : base;
    }
  });
}

/** The 0-based key a selector picks, or null on a tie (or no equal key). */
export function glyphSelect(
  sel: GlyphSelector,
  values: readonly number[],
  balance: number,
): number | null {
  const score = (v: number) =>
    sel === 'highest' ? v : sel === 'lowest' ? -v : -Math.abs(v - balance);
  if (sel === 'equals') {
    const hits = values.flatMap((v, i) => (v === balance ? [i] : []));
    return hits.length === 1 ? hits[0]! : null;
  }
  const best = Math.max(...values.map(score));
  const hits = values.flatMap((v, i) => (score(v) === best ? [i] : []));
  return hits.length === 1 ? hits[0]! : null;
}

/** Solves from the Charge and the two sheets only. Null if a selector ties or both pick one key. */
export function solveGlyph(
  charge: GlyphCharge,
  procedure: GlyphProcedure,
  reference: GlyphReference,
): GlyphSolution | null {
  const values = glyphValues(charge.keys, reference, procedure.adjustment);
  const first = glyphSelect(procedure.first, values, charge.balance);
  const second = glyphSelect(procedure.second, values, charge.balance);
  if (first === null || second === null || first === second) return null;
  // Values come only from the Value tables; selectors and the adjustment only from Entry order.
  return {
    first: first + 1,
    second: second + 1,
    consulted: ['glyph.procedure', 'glyph.reference'],
  };
}

// ---------------------------------------------------------------- generation

const ALL_GLYPHS: Glyph[] = Array.from({ length: 16 }, (_, id) => ({
  frame: (id >> 2) as FrameId,
  mark: (id & 3) as MarkId,
}));

function randomAdjustment(prng: Prng, keys: readonly Glyph[]): GlyphAdjustment {
  switch (prng.int(3)) {
    case 0:
      // A mark that appears on the panel, so the doubling changes something.
      return { kind: 'doubleMark', mark: prng.pick(keys).mark };
    case 1:
      return { kind: 'addOuter', amount: 3 };
    default:
      return { kind: 'addSharedFrame', amount: 2 };
  }
}

/**
 * One generation attempt. Key values are drawn before the Balance: an "equals" Balance is the
 * value of a random key; otherwise the Balance is uniform 1–25 (a decoy if no selector uses it).
 */
export function generateGlyph(prng: Prng): GlyphPanel {
  const keys = prng.sample(ALL_GLYPHS, GLYPH_KEY_COUNT);
  const reference: GlyphReference = {
    frameValues: prng.sample([1, 2, 3, 4, 5, 6], 4),
    markValues: prng.sample([0, 1, 2, 3, 4, 5], 4),
  };
  const adjustment = randomAdjustment(prng, keys);
  const [first, second] = prng.pick(GLYPH_SELECTOR_PAIRS);
  const values = glyphValues(keys, reference, adjustment);
  const balance =
    first === 'equals' || second === 'equals'
      ? values[prng.int(values.length)]!
      : prng.range(GLYPH_BALANCE.min, GLYPH_BALANCE.max);
  return {
    charge: { keys, balance },
    procedure: { adjustment, first: first!, second: second! },
    reference,
  };
}

/**
 * Valid by construction: glyph i = (frame i, mark i) with frame values 1, 2, 4, 6 and mark
 * values 0, 1, 2, 5 gives base values 1, 3, 6, 11. Whichever keys sit on the outside (+3), the
 * highest (11 or 14) and the lowest are unique and different keys.
 */
export function safeGlyph(prng: Prng): GlyphPanel {
  const order = prng.shuffle([0, 1, 2, 3]);
  const keys: Glyph[] = order.map((i) => ({ frame: i as FrameId, mark: i as MarkId }));
  return {
    charge: { keys, balance: prng.range(GLYPH_BALANCE.min, GLYPH_BALANCE.max) },
    procedure: { adjustment: { kind: 'addOuter', amount: 3 }, first: 'highest', second: 'lowest' },
    reference: { frameValues: [1, 2, 4, 6], markValues: [0, 1, 2, 5] },
  };
}

// ---------------------------------------------------------------- verification

const distinct = (xs: readonly unknown[]) =>
  new Set(xs.map((x) => JSON.stringify(x))).size === xs.length;

/** Every Normal constraint for a Glyph panel (spec 5.2). Empty = valid. */
export function verifyGlyph(p: GlyphPanel): string[] {
  const problems: string[] = [];
  const { keys, balance } = p.charge;
  if (keys.length !== GLYPH_KEY_COUNT || !distinct(keys)) problems.push('keys');
  const fv = p.reference.frameValues;
  const mv = p.reference.markValues;
  if (fv.length !== 4 || !distinct(fv) || !fv.every((v) => v >= 1 && v <= 6))
    problems.push('frame values');
  if (mv.length !== 4 || !distinct(mv) || !mv.every((v) => v >= 0 && v <= 5))
    problems.push('mark values');
  if (!Number.isInteger(balance) || balance < GLYPH_BALANCE.min || balance > GLYPH_BALANCE.max) {
    problems.push('balance range');
  }
  const pairOk = GLYPH_SELECTOR_PAIRS.some(
    ([a, b]) => a === p.procedure.first && b === p.procedure.second,
  );
  if (!pairOk) problems.push('selector pair');
  const values = glyphValues(keys, p.reference, p.procedure.adjustment);
  if (!values.every((v) => v >= GLYPH_VALUE.min && v <= GLYPH_VALUE.max))
    problems.push('value range');
  const unadjusted = keys.map((k) => fv[k.frame]! + mv[k.mark]!);
  if (values.every((v, i) => v === unadjusted[i])) problems.push('adjustment changes nothing');
  if (!solveGlyph(p.charge, p.procedure, p.reference)) problems.push('no unique answer');
  return problems;
}

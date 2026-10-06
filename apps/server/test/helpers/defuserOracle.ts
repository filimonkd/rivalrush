import type {
  FuseAction,
  FuseCharge,
  FuseCondition,
  FuseProcedure,
  FuseReference,
  GlyphCharge,
  GlyphProcedure,
  GlyphReference,
  ValveCharge,
  ValveProcedure,
  ValveReference,
  Vent,
} from '@rivalrush/shared';

/**
 * INDEPENDENT test-only oracle for Defuser panels. It deliberately imports NOTHING from
 * src/games/defuser: every rule is re-implemented here a different way (declarative predicates
 * over every possible input), so a bug shared by the generator and the production solver shows
 * up as a disagreement. Each function returns every input that satisfies the rules; a valid
 * panel has exactly one.
 */

// ---------------------------------------------------------------- Fuse Lines

function condTrue(c: FuseCondition, colors: number[], styles: string[]): boolean {
  if (c.kind === 'noColor') return colors.every((x) => x !== c.color);
  if (c.kind === 'colorAtLeastTwo')
    return colors.reduce((n, x) => n + (x === c.color ? 1 : 0), 0) > 1;
  if (c.kind === 'dashedExactly') return styles.join('').split('dashed').length - 1 === c.count;
  if (c.kind === 'endColor') return colors.at(c.end === 'top' ? 0 : -1) === c.color;
  // colorAbove: compare each adjacent pair as a string like "2>3".
  const pairs = colors.slice(1).map((lower, i) => `${colors[i]}>${lower}`);
  return pairs.includes(`${c.upper}>${c.lower}`);
}

/** Is line `n` (1-based) the line this action names? */
function actionNames(
  a: FuseAction,
  n: number,
  colors: number[],
  styles: string[],
  heat: number[],
): boolean {
  const i = n - 1;
  if (a.kind === 'colorEnd') {
    if (colors[i] !== a.color) return false;
    const others = colors.map((c, j) => (c === a.color ? j : -1)).filter((j) => j >= 0 && j !== i);
    return a.end === 'top' ? others.every((j) => j > i) : others.every((j) => j < i);
  }
  if (a.kind === 'nthSolid') {
    if (styles[i] !== 'solid') return false;
    return styles.slice(0, i).filter((s) => s === 'solid').length === a.n - 1;
  }
  // Heat: line i is in the group, no group line has strictly better Heat, and no UPPER group
  // line has equal Heat (equal Heat: the upper line counts).
  const inGroup = (j: number) => a.group === 'all' || styles[j] === a.group;
  if (!inGroup(i)) return false;
  const better = (x: number, y: number) => (a.which === 'highest' ? x > y : x < y);
  const h = heat[colors[i]!]!;
  for (let j = 0; j < colors.length; j++) {
    if (j === i || !inGroup(j)) continue;
    const hj = heat[colors[j]!]!;
    if (better(hj, h)) return false;
    if (hj === h && j < i) return false;
  }
  return true;
}

export function oracleFuseAnswers(
  charge: FuseCharge,
  p: FuseProcedure,
  r: FuseReference,
): number[] {
  const colors = charge.lines.map((l) => l.color as number);
  const styles = charge.lines.map((l) => l.style as string);
  // The deciding action: first rule whose condition is true, else Otherwise.
  const decider = [...p.rules, { if: null, then: p.otherwise }].find(
    (rule) => rule.if === null || condTrue(rule.if, colors, styles),
  )!.then;
  return [1, 2, 3, 4, 5].filter((n) => actionNames(decider, n, colors, styles, r.heat));
}

// ---------------------------------------------------------------- Glyph Ledger

function oracleGlyphValues(charge: GlyphCharge, p: GlyphProcedure, r: GlyphReference): number[] {
  const frames = charge.keys.map((k) => k.frame as number);
  return charge.keys.map((k, i) => {
    let v = r.frameValues[k.frame]! + r.markValues[k.mark]!;
    const a = p.adjustment;
    if (a.kind === 'doubleMark' && k.mark === a.mark) v += v;
    if (a.kind === 'addOuter' && (i === 0 || i === 3)) v += a.amount;
    if (a.kind === 'addSharedFrame' && frames.filter((f) => f === k.frame).length >= 2)
      v += a.amount;
    return v;
  });
}

/** Is key index `i` the one this selector names? */
function selects(sel: GlyphProcedure['first'], i: number, v: number[], balance: number): boolean {
  const others = v.filter((_, j) => j !== i);
  if (sel === 'highest') return others.every((o) => v[i]! > o);
  if (sel === 'lowest') return others.every((o) => v[i]! < o);
  if (sel === 'closest')
    return others.every((o) => Math.abs(v[i]! - balance) < Math.abs(o - balance));
  return v[i] === balance && others.every((o) => o !== balance);
}

/** Every ordered pair of different keys (1-based) the Entry order accepts. */
export function oracleGlyphAnswers(
  charge: GlyphCharge,
  p: GlyphProcedure,
  r: GlyphReference,
): Array<{ first: number; second: number }> {
  const v = oracleGlyphValues(charge, p, r);
  const out: Array<{ first: number; second: number }> = [];
  for (let a = 0; a < 4; a++) {
    for (let b = 0; b < 4; b++) {
      if (
        a !== b &&
        selects(p.first, a, v, charge.balance) &&
        selects(p.second, b, v, charge.balance)
      ) {
        out.push({ first: a + 1, second: b + 1 });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- Coolant Valve

const LAMP_COLUMN: Record<ValveCharge['lamp'], number> = { off: 0, steady: 1, pulsing: 2 };

/** Every (level, vent) pair, of the 10 possible, that the rules accept. */
export function oracleValveAnswers(
  charge: ValveCharge,
  p: ValveProcedure,
  r: ValveReference,
): Array<{ level: number; vent: Vent }> {
  const cell = r.grid[charge.plate]![LAMP_COLUMN[charge.lamp]]!;
  const shift = p.adjustments
    .filter((a) => a.from <= charge.gauge && charge.gauge <= a.to)
    .reduce((s, a) => s + a.delta, 0);
  const out: Array<{ level: number; vent: Vent }> = [];
  for (let level = 1; level <= 5; level++) {
    for (const vent of ['seal', 'vent'] as const) {
      if (level !== cell.level + shift) continue;
      const f = p.flip;
      const flips =
        (f.kind === 'levelEven' && level % 2 === 0) ||
        (f.kind === 'levelAtLeast' && level >= f.level) ||
        (f.kind === 'lampIs' && charge.lamp === f.lamp) ||
        (f.kind === 'gaugeIn' && f.from <= charge.gauge && charge.gauge <= f.to);
      if ((vent === cell.vent) !== flips) out.push({ level, vent });
    }
  }
  return out;
}

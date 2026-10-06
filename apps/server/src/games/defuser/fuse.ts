import {
  COLOR_IDS,
  FUSE_LINE_COUNT,
  type ColorId,
  type FuseAction,
  type FuseCharge,
  type FuseCondition,
  type FuseGroup,
  type FuseLine,
  type FuseProcedure,
  type FuseReference,
  type SheetId,
} from '@rivalrush/shared';
import type { Prng } from './prng.js';

/** Fuse Lines (docs/defuser.md 5.1): a Charge plus its two sheets. */
export interface FusePanel {
  charge: FuseCharge;
  procedure: FuseProcedure;
  reference: FuseReference;
}

export interface FuseSolution {
  /** 1-based line to cut. */
  line: number;
  /** 0-based index of the deciding rule; `procedure.rules.length` means "Otherwise". */
  decidingRule: number;
  /** Sheets an Analyst genuinely needs for this answer. */
  consulted: SheetId[];
}

export const FUSE_RULE_COUNT = 4;

// ---------------------------------------------------------------- rules → meaning

export function fuseConditionHolds(c: FuseCondition, charge: FuseCharge): boolean {
  const colors = charge.lines.map((l) => l.color);
  switch (c.kind) {
    case 'noColor':
      return !colors.includes(c.color);
    case 'colorAtLeastTwo':
      return colors.filter((x) => x === c.color).length >= 2;
    case 'dashedExactly':
      return charge.lines.filter((l) => l.style === 'dashed').length === c.count;
    case 'endColor':
      return (c.end === 'top' ? colors[0] : colors[colors.length - 1]) === c.color;
    case 'colorAbove':
      for (let i = 0; i + 1 < colors.length; i++) {
        if (colors[i] === c.upper && colors[i + 1] === c.lower) return true;
      }
      return false;
  }
}

/** 0-based indexes of the lines in a group, top to bottom. */
export function fuseGroupLines(charge: FuseCharge, group: FuseGroup): number[] {
  const out: number[] = [];
  charge.lines.forEach((l, i) => {
    if (group === 'all' || l.style === group) out.push(i);
  });
  return out;
}

/**
 * The 1-based line an action selects, judged on the panel as armed (cut lines still count), or
 * null when the action is impossible on this panel. Equal Heat: the upper line counts.
 */
export function fuseActionTarget(
  a: FuseAction,
  charge: FuseCharge,
  ref: FuseReference,
): number | null {
  switch (a.kind) {
    case 'heat': {
      let best: number | null = null;
      for (const i of fuseGroupLines(charge, a.group)) {
        if (best === null) {
          best = i;
          continue;
        }
        const h = ref.heat[charge.lines[i]!.color]!;
        const hb = ref.heat[charge.lines[best]!.color]!;
        // Strict comparison keeps the upper line on equal Heat.
        if (a.which === 'highest' ? h > hb : h < hb) best = i;
      }
      return best === null ? null : best + 1;
    }
    case 'colorEnd': {
      const idx = charge.lines.map((l) => l.color);
      const i = a.end === 'top' ? idx.indexOf(a.color) : idx.lastIndexOf(a.color);
      return i < 0 ? null : i + 1;
    }
    case 'nthSolid': {
      const solid = fuseGroupLines(charge, 'solid');
      return solid.length >= a.n ? solid[a.n - 1]! + 1 : null;
    }
  }
}

/** Heat genuinely matters for a Heat action only if its group has 2+ distinct colors. */
function heatMatters(a: FuseAction, charge: FuseCharge): boolean {
  if (a.kind !== 'heat') return false;
  const colors = new Set(fuseGroupLines(charge, a.group).map((i) => charge.lines[i]!.color));
  return colors.size >= 2;
}

/**
 * Solves from exactly what the team can see: the Charge (Operator) and the two sheets
 * (Analysts). Returns null if the deciding action is impossible.
 */
export function solveFuse(
  charge: FuseCharge,
  procedure: FuseProcedure,
  reference: FuseReference,
): FuseSolution | null {
  let deciding = procedure.rules.findIndex((r) => fuseConditionHolds(r.if, charge));
  if (deciding < 0) deciding = procedure.rules.length;
  const action =
    deciding < procedure.rules.length ? procedure.rules[deciding]!.then : procedure.otherwise;
  const line = fuseActionTarget(action, charge, reference);
  if (line === null) return null;
  const consulted: SheetId[] = ['fuse.procedure'];
  if (heatMatters(action, charge)) consulted.push('fuse.reference');
  return { line, decidingRule: deciding, consulted };
}

// ---------------------------------------------------------------- generation

/** Every condition the Ladder can state, in a fixed order. */
function allConditions(): FuseCondition[] {
  const out: FuseCondition[] = [];
  for (const color of COLOR_IDS) out.push({ kind: 'noColor', color });
  for (const color of COLOR_IDS) out.push({ kind: 'colorAtLeastTwo', color });
  for (const count of [1, 2, 3] as const) out.push({ kind: 'dashedExactly', count });
  for (const end of ['top', 'bottom'] as const) {
    for (const color of COLOR_IDS) out.push({ kind: 'endColor', end, color });
  }
  for (const upper of COLOR_IDS) {
    for (const lower of COLOR_IDS) out.push({ kind: 'colorAbove', upper, lower });
  }
  return out;
}
const CONDITIONS = allConditions();

function randomAction(prng: Prng): FuseAction {
  switch (prng.int(3)) {
    case 0:
      return {
        kind: 'heat',
        which: prng.pick(['highest', 'lowest'] as const),
        group: prng.pick(['all', 'dashed', 'solid'] as const),
      };
    case 1:
      return {
        kind: 'colorEnd',
        color: prng.pick(COLOR_IDS),
        end: prng.pick(['top', 'bottom'] as const),
      };
    default:
      return { kind: 'nthSolid', n: 2 };
  }
}

function randomCharge(prng: Prng): FuseCharge {
  let colors: ColorId[];
  do {
    colors = Array.from({ length: FUSE_LINE_COUNT }, () => prng.pick(COLOR_IDS));
  } while (new Set(colors).size < 3);
  const dashed = new Set(prng.sample([0, 1, 2, 3, 4], prng.range(1, 3)));
  const lines: FuseLine[] = colors.map((color, i) => ({
    color,
    style: dashed.has(i) ? 'dashed' : 'solid',
  }));
  return { lines };
}

/**
 * One generation attempt. The deciding rule (rule 2–5, "Otherwise" being 5) is chosen first
 * and uniformly, rules above it are made false, and its action is a Heat action whose group
 * has 2+ distinct colors, so both sheets are genuinely needed.
 */
export function generateFuse(prng: Prng): FusePanel {
  const charge = randomCharge(prng);
  const reference: FuseReference = { heat: prng.shuffle([1, 2, 3, 4, 5, 6]) };
  const deciding = prng.range(1, FUSE_RULE_COUNT); // 1..4, where 4 = Otherwise
  const holds = CONDITIONS.filter((c) => fuseConditionHolds(c, charge));
  const fails = CONDITIONS.filter((c) => !fuseConditionHolds(c, charge));
  const validGroups = (['all', 'dashed', 'solid'] as const).filter(
    (group) => new Set(fuseGroupLines(charge, group).map((i) => charge.lines[i]!.color)).size >= 2,
  );
  const decidingAction = (): FuseAction => ({
    kind: 'heat',
    which: prng.pick(['highest', 'lowest'] as const),
    group: prng.pick(validGroups),
  });

  const used = new Set<string>();
  const take = (pool: FuseCondition[]): FuseCondition => {
    const free = pool.filter((c) => !used.has(JSON.stringify(c)));
    const c = prng.pick(free);
    used.add(JSON.stringify(c));
    return c;
  };
  const rules = [];
  for (let i = 0; i < FUSE_RULE_COUNT; i++) {
    if (i < deciding) rules.push({ if: take(fails), then: randomAction(prng) });
    else if (i === deciding) rules.push({ if: take(holds), then: decidingAction() });
    else rules.push({ if: take(CONDITIONS), then: randomAction(prng) });
  }
  // "Otherwise" is always a Heat action over all lines (3+ colors), so it is valid whether or
  // not it decides.
  const otherwise: FuseAction = {
    kind: 'heat',
    which: prng.pick(['highest', 'lowest'] as const),
    group: 'all',
  };
  return { charge, procedure: { rules, otherwise }, reference };
}

/** Valid by construction: "Otherwise" decides with a Heat action over all lines. */
export function safeFuse(prng: Prng): FusePanel {
  const charge = randomCharge(prng);
  const reference: FuseReference = { heat: prng.shuffle([1, 2, 3, 4, 5, 6]) };
  const fails = CONDITIONS.filter((c) => !fuseConditionHolds(c, charge));
  const rules = prng
    .sample(fails, FUSE_RULE_COUNT)
    .map((c) => ({ if: c, then: { kind: 'nthSolid', n: 2 } as FuseAction }));
  return {
    charge,
    procedure: { rules, otherwise: { kind: 'heat', which: 'highest', group: 'all' } },
    reference,
  };
}

// ---------------------------------------------------------------- verification

/** Every Normal constraint for a Fuse panel (spec 5.1). Empty = valid. */
export function verifyFuse(p: FusePanel): string[] {
  const problems: string[] = [];
  const { lines } = p.charge;
  if (lines.length !== FUSE_LINE_COUNT) problems.push('line count');
  if (!lines.every((l) => COLOR_IDS.includes(l.color))) problems.push('color id');
  const dashed = lines.filter((l) => l.style === 'dashed').length;
  if (dashed < 1 || dashed > 3) problems.push('dashed count');
  if (new Set(lines.map((l) => l.color)).size < 3) problems.push('distinct colors');
  if ([...p.reference.heat].sort().join() !== '1,2,3,4,5,6') problems.push('heat permutation');
  if (p.procedure.rules.length !== FUSE_RULE_COUNT) problems.push('rule count');
  const conds = p.procedure.rules.map((r) => JSON.stringify(r.if));
  if (new Set(conds).size !== conds.length) problems.push('duplicate condition');
  if (p.procedure.otherwise.kind !== 'heat') problems.push('otherwise not heat');
  const s = solveFuse(p.charge, p.procedure, p.reference);
  if (!s) {
    problems.push('deciding action impossible');
    return problems;
  }
  if (s.decidingRule < 1) problems.push('rule 1 decides');
  const action =
    s.decidingRule < p.procedure.rules.length
      ? p.procedure.rules[s.decidingRule]!.then
      : p.procedure.otherwise;
  if (action.kind !== 'heat') problems.push('deciding action not heat');
  if (!s.consulted.includes('fuse.reference')) problems.push('heat table not needed');
  return problems;
}

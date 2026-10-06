import {
  VALVE_GAUGE,
  VALVE_LAMPS,
  VALVE_LEVEL,
  type PlateId,
  type SheetId,
  type ValveAdjustment,
  type ValveCell,
  type ValveCharge,
  type ValveFlip,
  type ValveProcedure,
  type ValveReference,
  type Vent,
} from '@rivalrush/shared';
import type { Prng } from './prng.js';

/** Coolant Valve (docs/defuser.md 5.3, corrected rules): a Charge plus its two sheets. */
export interface ValvePanel {
  charge: ValveCharge;
  procedure: ValveProcedure;
  reference: ValveReference;
}

export interface ValveSolution {
  level: number;
  vent: Vent;
  /** True if a gauge-range adjustment applied (target: about 60% of editions). */
  adjusted: boolean;
  consulted: SheetId[];
}

const DELTAS = [-2, -1, 1, 2] as const;
const flipVent = (v: Vent): Vent => (v === 'vent' ? 'seal' : 'vent');

// ---------------------------------------------------------------- rules → meaning

export function valveCell(charge: ValveCharge, ref: ValveReference): ValveCell {
  return ref.grid[charge.plate]![VALVE_LAMPS.indexOf(charge.lamp)]!;
}

/** The adjustment whose range contains the gauge (ranges never overlap in Normal). */
export function valveAdjustmentFor(
  gauge: number,
  adjustments: readonly ValveAdjustment[],
): ValveAdjustment | null {
  return adjustments.find((a) => gauge >= a.from && gauge <= a.to) ?? null;
}

export function valveFlipApplies(
  flip: ValveFlip,
  charge: ValveCharge,
  finalLevel: number,
): boolean {
  switch (flip.kind) {
    case 'levelEven':
      return finalLevel % 2 === 0;
    case 'levelAtLeast':
      return finalLevel >= flip.level;
    case 'lampIs':
      return charge.lamp === flip.lamp;
    case 'gaugeIn':
      return charge.gauge >= flip.from && charge.gauge <= flip.to;
  }
}

/**
 * Solves from the Charge and the two sheets only: base level and vent mark from the Level grid,
 * then the matching adjustment, then the vent flip. Null if the level leaves 1–5 (never clamped).
 */
export function solveValve(
  charge: ValveCharge,
  procedure: ValveProcedure,
  reference: ValveReference,
): ValveSolution | null {
  const cell = valveCell(charge, reference);
  const adj = valveAdjustmentFor(charge.gauge, procedure.adjustments);
  const level = cell.level + (adj?.delta ?? 0);
  if (level < VALVE_LEVEL.min || level > VALVE_LEVEL.max) return null;
  const vent = valveFlipApplies(procedure.flip, charge, level) ? flipVent(cell.vent) : cell.vent;
  // The cell is only on the Level grid; adjustments and the flip only on Adjustments.
  return { level, vent, adjusted: adj !== null, consulted: ['valve.procedure', 'valve.reference'] };
}

// ---------------------------------------------------------------- generation

function randomRanges(prng: Prng): Array<{ from: number; to: number }> {
  // Two non-overlapping ranges, each 25–35 wide: together they cover 50–70% of the gauge.
  const w1 = prng.range(25, 35);
  const w2 = prng.range(25, 35);
  const free = VALVE_GAUGE.max - VALVE_GAUGE.min + 1 - w1 - w2;
  const g0 = prng.range(0, free);
  const g1 = prng.range(0, free - g0);
  const a = { from: g0, to: g0 + w1 - 1 };
  const b = { from: a.to + 1 + g1, to: a.to + g1 + w2 };
  return prng.int(2) === 0 ? [a, b] : [b, a];
}

function randomFlip(prng: Prng): ValveFlip {
  switch (prng.int(4)) {
    case 0:
      return { kind: 'levelEven' };
    case 1:
      return { kind: 'levelAtLeast', level: 4 };
    case 2:
      return { kind: 'lampIs', lamp: prng.pick(VALVE_LAMPS) };
    default: {
      const from = prng.range(0, 80);
      return { kind: 'gaugeIn', from, to: from + 19 };
    }
  }
}

const randomCell = (prng: Prng): ValveCell => ({
  level: prng.range(VALVE_LEVEL.min, VALVE_LEVEL.max),
  vent: prng.pick(['seal', 'vent'] as const),
});

/**
 * Answer drawn first (spec 5.3): the final level and vent are uniform and drawn before anything
 * the Operator sees, and never redrawn, so nothing on the Charge predicts them. If the gauge
 * falls in a range, only THAT range's change is redrawn, among the changes that keep the base
 * level in 1–5, so the "adjustment applies" rate equals the ranges' coverage.
 */
export function generateValve(prng: Prng, opts: { avoidRanges?: boolean } = {}): ValvePanel {
  const level = prng.range(VALVE_LEVEL.min, VALVE_LEVEL.max);
  const vent = prng.pick(['seal', 'vent'] as const);
  const charge: ValveCharge = {
    plate: prng.int(4) as PlateId,
    lamp: prng.pick(VALVE_LAMPS),
    gauge: prng.range(VALVE_GAUGE.min, VALVE_GAUGE.max),
  };
  const flip = randomFlip(prng);
  let ranges = randomRanges(prng);
  if (opts.avoidRanges) {
    while (ranges.some((r) => charge.gauge >= r.from && charge.gauge <= r.to)) {
      ranges = randomRanges(prng);
    }
  }
  const adjustments: ValveAdjustment[] = ranges.map((r) => ({ ...r, delta: prng.pick(DELTAS) }));
  const hit = adjustments.find((a) => charge.gauge >= a.from && charge.gauge <= a.to);
  if (hit)
    hit.delta = prng.pick(
      DELTAS.filter((d) => level - d >= VALVE_LEVEL.min && level - d <= VALVE_LEVEL.max),
    );
  const base = level - (hit?.delta ?? 0);
  const procedure: ValveProcedure = { adjustments, flip };
  const cellVent = valveFlipApplies(flip, charge, level) ? flipVent(vent) : vent;
  const grid = Array.from({ length: 4 }, () => Array.from({ length: 3 }, () => randomCell(prng)));
  grid[charge.plate]![VALVE_LAMPS.indexOf(charge.lamp)] = { level: base, vent: cellVent };
  return { charge, procedure, reference: { grid } };
}

/** Valid by construction: the gauge lies outside both ranges, so the base level is the answer. */
export function safeValve(prng: Prng): ValvePanel {
  return generateValve(prng, { avoidRanges: true });
}

// ---------------------------------------------------------------- verification

/** Every Normal constraint for a Valve panel (spec 5.3). Empty = valid. */
export function verifyValve(p: ValvePanel): string[] {
  const problems: string[] = [];
  const { plate, lamp, gauge } = p.charge;
  if (![0, 1, 2, 3].includes(plate) || !VALVE_LAMPS.includes(lamp)) problems.push('plate/lamp');
  if (!Number.isInteger(gauge) || gauge < VALVE_GAUGE.min || gauge > VALVE_GAUGE.max)
    problems.push('gauge');
  const g = p.reference.grid;
  if (g.length !== 4 || g.some((row) => row.length !== 3)) problems.push('grid shape');
  if (g.flat().some((c) => c.level < VALVE_LEVEL.min || c.level > VALVE_LEVEL.max))
    problems.push('cell level');
  const adj = p.procedure.adjustments;
  if (adj.length !== 2) problems.push('adjustment count');
  for (const a of adj) {
    if (!(DELTAS as readonly number[]).includes(a.delta)) problems.push('delta');
    if (a.from < VALVE_GAUGE.min || a.to > VALVE_GAUGE.max || a.from > a.to) problems.push('range');
  }
  if (adj.length === 2) {
    const [a, b] = [...adj].sort((x, y) => x.from - y.from);
    if (a!.to >= b!.from) problems.push('ranges overlap');
  }
  if (!solveValve(p.charge, p.procedure, p.reference)) problems.push('level outside 1–5');
  return problems;
}

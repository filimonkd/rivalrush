import {
  DEFUSER_COLORS,
  GLYPH_FRAMES,
  GLYPH_MARKS,
  VALVE_LAMPS,
  VALVE_PLATE_COLORS,
  sheetInfo,
  type ColorId,
  type FuseAction,
  type FuseCondition,
  type FuseProcedure,
  type FuseReference,
  type GlyphAdjustment,
  type GlyphProcedure,
  type GlyphReference,
  type GlyphSelector,
  type SheetData,
  type SheetId,
  type SheetType,
  type ValveFlip,
  type ValveLamp,
  type ValveProcedure,
  type ValveReference,
} from './defuser.js';

/**
 * Sheet renderer: canonical rule data → deterministic sheet text (spec section 6).
 *
 * This is the ONLY place a Defuser rule becomes words. It formats data the Analyst holding the
 * sheet has already been sent, so it is safe in the client bundle. It never solves anything.
 */
export interface RenderedSheet {
  id: SheetId;
  type: SheetType;
  title: string;
  tabLabel: string;
  /** Procedure sheets: numbered items, in order. Empty for Reference sheets. */
  items: string[];
  /** Reference sheets: one table. Null for Procedure sheets. */
  table: { header: string[]; rows: string[][] } | null;
  /** Reference sheets: at most one short note. */
  note: string | null;
}

/** "Ruby ●": a color is always named with its symbol. */
export function colorLabel(color: ColorId): string {
  const c = DEFUSER_COLORS[color];
  return `${c.name} ${c.symbol}`;
}

const lampName = (lamp: ValveLamp): string => lamp[0]!.toUpperCase() + lamp.slice(1);
const two = (n: number): string => String(n).padStart(2, '0');
const levels = (n: number): string => (n === 1 ? 'one level' : 'two levels');

export function fuseConditionText(c: FuseCondition): string {
  switch (c.kind) {
    case 'noColor':
      return `there is no ${colorLabel(c.color)} bead`;
    case 'colorAtLeastTwo':
      return `two or more beads are ${colorLabel(c.color)}`;
    case 'dashedExactly':
      return c.count === 1 ? 'exactly 1 line is dashed' : `exactly ${c.count} lines are dashed`;
    case 'endColor':
      return `the ${c.end} bead is ${colorLabel(c.color)}`;
    case 'colorAbove':
      return `a ${colorLabel(c.upper)} bead is directly above a ${colorLabel(c.lower)} bead`;
  }
}

export function fuseActionText(a: FuseAction): string {
  switch (a.kind) {
    case 'heat': {
      const group = a.group === 'all' ? '' : `${a.group} `;
      return `cut the ${group}line with the ${a.which} Heat`;
    }
    case 'colorEnd':
      return `cut the ${colorLabel(a.color)} line nearest the ${a.end}`;
    case 'nthSolid':
      return 'cut the 2nd solid line from the top';
  }
}

export function renderFuseProcedure(p: FuseProcedure): string[] {
  const items = p.rules.map(
    (r, i) => `${i + 1}. If ${fuseConditionText(r.if)}, ${fuseActionText(r.then)}.`,
  );
  items.push(`${p.rules.length + 1}. Otherwise, ${fuseActionText(p.otherwise)}.`);
  return items;
}

export const FUSE_TIE_NOTE = 'Equal Heat: the upper line counts.';

export function renderFuseReference(r: FuseReference): RenderedSheet['table'] {
  return {
    header: ['Color', 'Heat'],
    rows: DEFUSER_COLORS.map((c) => [colorLabel(c.id as ColorId), String(r.heat[c.id])]),
  };
}

export function glyphAdjustmentText(a: GlyphAdjustment): string {
  switch (a.kind) {
    case 'doubleMark':
      return `Double the value of any key whose mark is a ${GLYPH_MARKS[a.mark]}.`;
    case 'addOuter':
      return `Add ${a.amount} to the outer keys (1 and 4).`;
    case 'addSharedFrame':
      return `Add ${a.amount} to any key whose frame is on another key too.`;
  }
}

export function glyphSelectorText(s: GlyphSelector): string {
  switch (s) {
    case 'highest':
      return 'the key with the highest value';
    case 'lowest':
      return 'the key with the lowest value';
    case 'closest':
      return 'the key whose value is closest to the Balance';
    case 'equals':
      return 'the key whose value equals the Balance';
  }
}

export function renderGlyphProcedure(p: GlyphProcedure): string[] {
  return [
    `1. ${glyphAdjustmentText(p.adjustment)}`,
    `2. First key: ${glyphSelectorText(p.first)}.`,
    `3. Second key: ${glyphSelectorText(p.second)}.`,
  ];
}

export const GLYPH_VALUE_NOTE = 'Key value = frame value + mark value.';

export function renderGlyphReference(r: GlyphReference): RenderedSheet['table'] {
  return {
    header: ['Frame', 'Value', 'Mark', 'Value'],
    rows: GLYPH_FRAMES.map((frame, i) => [
      frame,
      String(r.frameValues[i]),
      GLYPH_MARKS[i]!,
      String(r.markValues[i]),
    ]),
  };
}

export function valveFlipText(f: ValveFlip): string {
  switch (f.kind) {
    case 'levelEven':
      return 'Flip the vent if the final level is even.';
    case 'levelAtLeast':
      return `Flip the vent if the final level is ${f.level} or more.`;
    case 'lampIs':
      return `Flip the vent if the lamp is ${lampName(f.lamp)}.`;
    case 'gaugeIn':
      return `Flip the vent if the gauge reads ${two(f.from)}–${two(f.to)}.`;
  }
}

export function renderValveProcedure(p: ValveProcedure): string[] {
  const items = p.adjustments.map(
    (a, i) =>
      `${i + 1}. Gauge ${two(a.from)}–${two(a.to)}: ${a.delta > 0 ? 'raise' : 'lower'} ${levels(Math.abs(a.delta))}.`,
  );
  items.push(`${items.length + 1}. ${valveFlipText(p.flip)}`);
  return items;
}

export const VALVE_GRID_NOTE = 'S = Seal, V = Vent.';

export function renderValveReference(r: ValveReference): RenderedSheet['table'] {
  return {
    header: ['Plate', ...VALVE_LAMPS.map(lampName)],
    rows: VALVE_PLATE_COLORS.map((color, plate) => [
      colorLabel(color),
      ...r.grid[plate]!.map((cell) => `${cell.level}·${cell.vent === 'vent' ? 'V' : 'S'}`),
    ]),
  };
}

/** Renders any sheet. Deterministic: the same data always gives the same text. */
export function renderSheet(sheet: SheetData): RenderedSheet {
  const info = sheetInfo(sheet.id);
  const base = { id: info.id, type: info.type, title: info.title, tabLabel: info.tabLabel };
  switch (sheet.id) {
    case 'fuse.procedure':
      return { ...base, items: renderFuseProcedure(sheet.data), table: null, note: null };
    case 'fuse.reference':
      return { ...base, items: [], table: renderFuseReference(sheet.data), note: FUSE_TIE_NOTE };
    case 'glyph.procedure':
      return { ...base, items: renderGlyphProcedure(sheet.data), table: null, note: null };
    case 'glyph.reference':
      return {
        ...base,
        items: [],
        table: renderGlyphReference(sheet.data),
        note: GLYPH_VALUE_NOTE,
      };
    case 'valve.procedure':
      return { ...base, items: renderValveProcedure(sheet.data), table: null, note: null };
    case 'valve.reference':
      return { ...base, items: [], table: renderValveReference(sheet.data), note: VALVE_GRID_NOTE };
  }
}

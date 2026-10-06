import {
  PANEL_IDS,
  SHEET_IDS,
  SHEET_LIMITS,
  renderSheet,
  sheetIdOf,
  type DefuserCharge,
  type DefuserDifficulty,
  type DefuserSolution,
  type PanelId,
  type SheetData,
  type SheetId,
} from '@rivalrush/shared';
import { generateFuse, safeFuse, solveFuse, verifyFuse, type FusePanel } from './fuse.js';
import { generateGlyph, safeGlyph, solveGlyph, verifyGlyph, type GlyphPanel } from './glyph.js';
import { Prng, editionLabel, isSeed, seedFromRandom } from './prng.js';
import { generateValve, safeValve, solveValve, verifyValve, type ValvePanel } from './valve.js';

/**
 * Edition pipeline (docs/defuser.md section 6): seed → per panel { draw Codebook data and
 * Charge → solve → verify → retry, up to MAX_ATTEMPTS → safe template } → sheet assignment.
 *
 * Bump GENERATOR_VERSION on ANY change that alters generated editions; the golden-seed test
 * fails until you do (test/fixtures/defuser-golden.json).
 */
export const GENERATOR_VERSION = 1;
export const MAX_ATTEMPTS = 200;

export interface PanelBuild<P> {
  panel: P;
  /** Attempts used (1 = first draw accepted). */
  attempts: number;
  usedSafeTemplate: boolean;
}

/** A whole generated game. Server-only: never sent to a client as is. */
export interface Edition {
  seed: string;
  generatorVersion: number;
  difficulty: DefuserDifficulty;
  label: string;
  analystCount: number;
  fuse: PanelBuild<FusePanel>;
  glyph: PanelBuild<GlyphPanel>;
  valve: PanelBuild<ValvePanel>;
  /** The shuffled panel order π used for sheet assignment. */
  panelOrder: PanelId[];
  /** Sheets per Analyst, A first, in the initial assignment (catalogue order within each). */
  assignment: SheetId[][];
  charge: DefuserCharge;
  solution: DefuserSolution;
}

// ---------------------------------------------------------------- sheets

export function sheetData(e: Pick<Edition, 'fuse' | 'glyph' | 'valve'>, id: SheetId): SheetData {
  switch (id) {
    case 'fuse.procedure':
      return { id, data: e.fuse.panel.procedure };
    case 'fuse.reference':
      return { id, data: e.fuse.panel.reference };
    case 'glyph.procedure':
      return { id, data: e.glyph.panel.procedure };
    case 'glyph.reference':
      return { id, data: e.glyph.panel.reference };
    case 'valve.procedure':
      return { id, data: e.valve.panel.procedure };
    case 'valve.reference':
      return { id, data: e.valve.panel.reference };
  }
}

/** Sheet size limits (spec section 6). Empty = within limits. */
export function sheetSizeProblems(sheet: SheetData): string[] {
  const r = renderSheet(sheet);
  const problems: string[] = [];
  if (r.items.length > SHEET_LIMITS.procedureItems) problems.push(`${r.id}: too many items`);
  for (const item of r.items) {
    if ([...item].length > SHEET_LIMITS.procedureItemChars) problems.push(`${r.id}: item too long`);
  }
  if (r.table) {
    if (r.table.rows.length > SHEET_LIMITS.referenceRows) problems.push(`${r.id}: too many rows`);
    if (r.table.header.length > SHEET_LIMITS.referenceColumns)
      problems.push(`${r.id}: too many columns`);
  }
  if (r.note && [...r.note].length > SHEET_LIMITS.referenceNoteChars)
    problems.push(`${r.id}: note too long`);
  return problems;
}

/**
 * Initial assignment (spec section 7) for 1–3 Analysts, from the shuffled panel order π:
 * 1 Analyst holds all 6; with 2+ Analysts a panel's Procedure and Reference never share a holder.
 */
export function assignSheets(order: readonly PanelId[], analystCount: number): SheetId[][] {
  const P = (i: number) => sheetIdOf(order[i]!, 'procedure');
  const R = (i: number) => sheetIdOf(order[i]!, 'reference');
  const byCatalogue = (ids: SheetId[]) =>
    [...ids].sort((a, b) => SHEET_IDS.indexOf(a) - SHEET_IDS.indexOf(b));
  switch (analystCount) {
    case 1:
      return [[...SHEET_IDS]];
    case 2:
      return [byCatalogue([P(0), R(1), P(2)]), byCatalogue([R(0), P(1), R(2)])];
    case 3:
      return [byCatalogue([P(0), R(1)]), byCatalogue([P(1), R(2)]), byCatalogue([P(2), R(0)])];
    default:
      throw new RangeError(`Defuser needs 1–3 Analysts, got ${analystCount}`);
  }
}

// ---------------------------------------------------------------- pipeline

function build<P>(
  prng: Prng,
  generate: (prng: Prng) => P,
  safe: (prng: Prng) => P,
  verify: (panel: P) => string[],
  sheets: (panel: P) => SheetData[],
): PanelBuild<P> {
  const valid = (p: P) =>
    verify(p).length === 0 && sheets(p).every((s) => sheetSizeProblems(s).length === 0);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const panel = generate(prng);
    if (valid(panel)) return { panel, attempts: attempt, usedSafeTemplate: false };
  }
  const panel = safe(prng);
  if (!valid(panel)) {
    // Unreachable: safe templates are valid by construction (and tested to be).
    throw new Error('Defuser safe template failed verification');
  }
  return { panel, attempts: MAX_ATTEMPTS, usedSafeTemplate: true };
}

export interface EditionOptions {
  seed: string;
  analystCount: number;
  difficulty?: DefuserDifficulty;
}

/**
 * Builds the whole edition deterministically from the seed: same seed, generator version,
 * Analyst count and difficulty → identical edition.
 */
export function generateEdition(opts: EditionOptions): Edition {
  if (!isSeed(opts.seed)) throw new RangeError('seed must be 32 lowercase hex characters');
  const prng = new Prng(opts.seed);
  const fuse = build(prng, generateFuse, safeFuse, verifyFuse, (p) => [
    { id: 'fuse.procedure', data: p.procedure },
    { id: 'fuse.reference', data: p.reference },
  ]);
  const glyph = build(prng, generateGlyph, safeGlyph, verifyGlyph, (p) => [
    { id: 'glyph.procedure', data: p.procedure },
    { id: 'glyph.reference', data: p.reference },
  ]);
  const valve = build(prng, generateValve, safeValve, verifyValve, (p) => [
    { id: 'valve.procedure', data: p.procedure },
    { id: 'valve.reference', data: p.reference },
  ]);
  const panelOrder = prng.shuffle(PANEL_IDS);
  const f = solveFuse(fuse.panel.charge, fuse.panel.procedure, fuse.panel.reference)!;
  const g = solveGlyph(glyph.panel.charge, glyph.panel.procedure, glyph.panel.reference)!;
  const v = solveValve(valve.panel.charge, valve.panel.procedure, valve.panel.reference)!;
  return {
    seed: opts.seed,
    generatorVersion: GENERATOR_VERSION,
    difficulty: opts.difficulty ?? 'normal',
    label: editionLabel(opts.seed),
    analystCount: opts.analystCount,
    fuse,
    glyph,
    valve,
    panelOrder,
    assignment: assignSheets(panelOrder, opts.analystCount),
    charge: { fuse: fuse.panel.charge, glyph: glyph.panel.charge, valve: valve.panel.charge },
    solution: {
      fuse: { line: f.line },
      glyph: { first: g.first, second: g.second },
      valve: { level: v.level, vent: v.vent },
    },
  };
}

/** Draws the seed from the platform's injected random source, then builds the edition. */
export function generateEditionFromRandom(
  random: () => number,
  analystCount: number,
  difficulty: DefuserDifficulty = 'normal',
): Edition {
  return generateEdition({ seed: seedFromRandom(random), analystCount, difficulty });
}

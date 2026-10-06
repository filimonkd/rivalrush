import { z } from 'zod';
import { CC_COLORS } from './colorCipher.js';
import type { CoopPlayerStatus, CoopResult } from './games.js';

/**
 * Defuser shared contract (docs/defuser.md). Only types, schemas, the sheet catalogue and the
 * rule-data shapes live here: the generator and the solver are server-only. Status: foundation
 * only. There is no playable Defuser yet.
 */
export const DEFUSER_ID = 'defuser' as const;

/** Normal difficulty, the only one in the MVP (spec sections 4, 11, 20). */
export const DEFUSER_LIMITS = {
  minPlayers: 2,
  maxPlayers: 4,
  briefingSeconds: 20,
  countdownBaseSeconds: 240,
  countdownPerExtraAnalystSeconds: 30,
  maxFaults: 3,
} as const;

/** Countdown length for a team, from the number of Analysts at game start (exact). */
export function defuserCountdownSeconds(analystCount: number): number {
  return (
    DEFUSER_LIMITS.countdownBaseSeconds +
    DEFUSER_LIMITS.countdownPerExtraAnalystSeconds * (analystCount - 1)
  );
}

export const defuserSettingsSchema = z
  .object({
    difficulty: z.literal('normal').default('normal'),
  })
  .strict();

export type DefuserSettings = z.infer<typeof defuserSettingsSchema>;
export type DefuserDifficulty = DefuserSettings['difficulty'];

// ---------------------------------------------------------------- palette, panels, sheets

/** Same six colors and symbols as Color Cipher, so color is never the only cue. */
export const DEFUSER_COLORS = CC_COLORS;
export type ColorId = 0 | 1 | 2 | 3 | 4 | 5;
export const COLOR_IDS: readonly ColorId[] = [0, 1, 2, 3, 4, 5];

export const PANEL_IDS = ['fuse', 'glyph', 'valve'] as const;
export type PanelId = (typeof PANEL_IDS)[number];

export const PANEL_NAMES: Record<PanelId, string> = {
  fuse: 'Fuse Lines',
  glyph: 'Glyph Ledger',
  valve: 'Coolant Valve',
};

export type SheetType = 'procedure' | 'reference';

/** Canonical sheet ids, in catalogue order (spec section 6). */
export const SHEET_IDS = [
  'fuse.procedure',
  'fuse.reference',
  'glyph.procedure',
  'glyph.reference',
  'valve.procedure',
  'valve.reference',
] as const;
export type SheetId = (typeof SHEET_IDS)[number];

export interface SheetInfo {
  id: SheetId;
  panel: PanelId;
  type: SheetType;
  /** Full title used in the UI, the index and toasts. */
  title: string;
  /** Short tab label. */
  tabLabel: string;
}

/** The sheet catalogue (spec section 6). Used everywhere a sheet is named. */
export const SHEETS: readonly SheetInfo[] = [
  {
    id: 'fuse.procedure',
    panel: 'fuse',
    type: 'procedure',
    title: 'Fuse Lines · Ladder',
    tabLabel: 'Ladder',
  },
  {
    id: 'fuse.reference',
    panel: 'fuse',
    type: 'reference',
    title: 'Fuse Lines · Heat table',
    tabLabel: 'Heat table',
  },
  {
    id: 'glyph.procedure',
    panel: 'glyph',
    type: 'procedure',
    title: 'Glyph Ledger · Entry order',
    tabLabel: 'Entry order',
  },
  {
    id: 'glyph.reference',
    panel: 'glyph',
    type: 'reference',
    title: 'Glyph Ledger · Value tables',
    tabLabel: 'Value tables',
  },
  {
    id: 'valve.procedure',
    panel: 'valve',
    type: 'procedure',
    title: 'Coolant Valve · Adjustments',
    tabLabel: 'Adjustments',
  },
  {
    id: 'valve.reference',
    panel: 'valve',
    type: 'reference',
    title: 'Coolant Valve · Level grid',
    tabLabel: 'Level grid',
  },
];

export function sheetInfo(id: SheetId): SheetInfo {
  return SHEETS.find((s) => s.id === id)!;
}

export function sheetIdOf(panel: PanelId, type: SheetType): SheetId {
  return `${panel}.${type}`;
}

/** Sheet size limits checked by the generator and the tests (spec section 6). */
export const SHEET_LIMITS = {
  procedureItems: 6,
  // The longest possible Ladder rule renders at 98 characters (spec 6, rev 3).
  procedureItemChars: 100,
  referenceRows: 6,
  referenceColumns: 4,
  referenceNoteChars: 60,
} as const;

// ---------------------------------------------------------------- Fuse Lines (spec 5.1)

export const FUSE_LINE_COUNT = 5;
export type FuseStyle = 'solid' | 'dashed';

export interface FuseLine {
  color: ColorId;
  style: FuseStyle;
}

/** What the Operator sees: line 1 (top) to line 5 (bottom). */
export interface FuseCharge {
  lines: FuseLine[];
}

export type FuseCondition =
  | { kind: 'noColor'; color: ColorId }
  | { kind: 'colorAtLeastTwo'; color: ColorId }
  | { kind: 'dashedExactly'; count: 1 | 2 | 3 }
  | { kind: 'endColor'; end: 'top' | 'bottom'; color: ColorId }
  | { kind: 'colorAbove'; upper: ColorId; lower: ColorId };

export type FuseGroup = 'all' | 'dashed' | 'solid';

export type FuseAction =
  /** Needs the Heat table (Reference). */
  | { kind: 'heat'; which: 'highest' | 'lowest'; group: FuseGroup }
  /** Decoys: never decide in Normal. */
  | { kind: 'colorEnd'; color: ColorId; end: 'top' | 'bottom' }
  | { kind: 'nthSolid'; n: 2 };

export interface FuseRule {
  if: FuseCondition;
  then: FuseAction;
}

/** Procedure sheet "Ladder": rules read top to bottom, the first true one decides. */
export interface FuseProcedure {
  rules: FuseRule[];
  otherwise: FuseAction;
}

/** Reference sheet "Heat table": `heat[colorId]` is that color's Heat, 1–6. */
export interface FuseReference {
  heat: number[];
}

// ---------------------------------------------------------------- Glyph Ledger (spec 5.2)

export const GLYPH_KEY_COUNT = 4;
export const GLYPH_FRAMES = ['Circle', 'Triangle', 'Square', 'Hexagon'] as const;
export const GLYPH_MARKS = ['Dot', 'Bar', 'Cross', 'Ring'] as const;
export type FrameId = 0 | 1 | 2 | 3;
export type MarkId = 0 | 1 | 2 | 3;

/** Balance readout range (Normal). Adjusted key values are 1–22 (exact). */
export const GLYPH_BALANCE = { min: 1, max: 25 } as const;
export const GLYPH_VALUE = { min: 1, max: 22 } as const;

export interface Glyph {
  frame: FrameId;
  mark: MarkId;
}

/** What the Operator sees: keys 1–4, left to right, and the Balance. */
export interface GlyphCharge {
  keys: Glyph[];
  balance: number;
}

export type GlyphAdjustment =
  | { kind: 'doubleMark'; mark: MarkId }
  | { kind: 'addOuter'; amount: 3 }
  | { kind: 'addSharedFrame'; amount: 2 };

export type GlyphSelector = 'highest' | 'lowest' | 'closest' | 'equals';

/** Procedure sheet "Entry order". */
export interface GlyphProcedure {
  adjustment: GlyphAdjustment;
  first: GlyphSelector;
  second: GlyphSelector;
}

/** Reference sheet "Value tables": by frame id and by mark id. */
export interface GlyphReference {
  frameValues: number[];
  markValues: number[];
}

// ---------------------------------------------------------------- Coolant Valve (spec 5.3)

/** Plate colors, by plate index: Ruby, Sun, Leaf, Sky. */
export const VALVE_PLATE_COLORS: readonly ColorId[] = [0, 2, 3, 4];
export type PlateId = 0 | 1 | 2 | 3;
export const VALVE_LAMPS = ['off', 'steady', 'pulsing'] as const;
export type ValveLamp = (typeof VALVE_LAMPS)[number];
export type Vent = 'seal' | 'vent';
export const VALVE_LEVEL = { min: 1, max: 5 } as const;
export const VALVE_GAUGE = { min: 0, max: 99 } as const;

/** What the Operator sees. */
export interface ValveCharge {
  plate: PlateId;
  lamp: ValveLamp;
  gauge: number;
}

export interface ValveCell {
  level: number;
  vent: Vent;
}

/** Reference sheet "Level grid": `grid[plate][lampIndex]` = base level and vent mark. */
export interface ValveReference {
  grid: ValveCell[][];
}

export interface ValveAdjustment {
  /** Inclusive gauge range. */
  from: number;
  to: number;
  delta: -2 | -1 | 1 | 2;
}

export type ValveFlip =
  | { kind: 'levelEven' }
  | { kind: 'levelAtLeast'; level: 4 }
  | { kind: 'lampIs'; lamp: ValveLamp }
  | { kind: 'gaugeIn'; from: number; to: number };

/** Procedure sheet "Adjustments": two non-overlapping level adjustments and one vent flip. */
export interface ValveProcedure {
  adjustments: ValveAdjustment[];
  flip: ValveFlip;
}

// ---------------------------------------------------------------- sheets as data

/** One sheet's content, exactly as an Analyst who holds it will receive it. */
export type SheetData =
  | { id: 'fuse.procedure'; data: FuseProcedure }
  | { id: 'fuse.reference'; data: FuseReference }
  | { id: 'glyph.procedure'; data: GlyphProcedure }
  | { id: 'glyph.reference'; data: GlyphReference }
  | { id: 'valve.procedure'; data: ValveProcedure }
  | { id: 'valve.reference'; data: ValveReference };

/** The full Charge, as the Operator sees it when armed. */
export interface DefuserCharge {
  fuse: FuseCharge;
  glyph: GlyphCharge;
  valve: ValveCharge;
}

/** The correct inputs. Server-only while a game is live; shown only in the debrief. */
export interface DefuserSolution {
  fuse: { line: number };
  glyph: { first: number; second: number };
  valve: { level: number; vent: Vent };
}

// ---------------------------------------------------------------- actions (spec section 9)

export const defuserActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('READY') }).strict(),
  z
    .object({ type: z.literal('CUT_LINE'), line: z.number().int().min(1).max(FUSE_LINE_COUNT) })
    .strict(),
  z
    .object({ type: z.literal('PRESS_GLYPH'), key: z.number().int().min(1).max(GLYPH_KEY_COUNT) })
    .strict(),
  z
    .object({
      type: z.literal('SET_VALVE'),
      level: z.number().int().min(VALVE_LEVEL.min).max(VALVE_LEVEL.max),
      vent: z.enum(['seal', 'vent']),
    })
    .strict(),
  z.object({ type: z.literal('REJOIN') }).strict(),
]);

export type DefuserPlayerAction = z.infer<typeof defuserActionSchema>;

// ---------------------------------------------------------------- roles, moves, views

export type DefuserPhase = 'BRIEFING' | 'ARMED' | 'DEFUSED' | 'DETONATED' | 'ABANDONED';
export type DefuserRole = 'operator' | 'analyst';
export type AnalystLetter = 'A' | 'B' | 'C' | 'D';

export type DefuserInput = { line: number } | { key: number } | { level: number; vent: Vent };

/**
 * One entry of the match-history move log: an accepted Operator input (positions and levels
 * only, never Charge attributes) or a drop-out, promotion or rejoin.
 */
export type DefuserMove =
  | {
      kind: 'input';
      playerId: string;
      panel: PanelId;
      input: DefuserInput;
      ok: boolean;
      /** Epoch ms. */
      at: number;
      /** Ms since the Charge was armed. */
      atMs: number;
    }
  | {
      kind: 'system';
      playerId: string;
      event: 'timed_out' | 'left' | 'promoted' | 'rejoined';
      at: number;
      atMs: number;
    };

export interface DefuserRosterEntry {
  userId: string;
  role: DefuserRole | null;
  letter: AnalystLetter | null;
  status: CoopPlayerStatus;
  ready: boolean;
}

/** Fields every view carries (spec section 18). */
export interface DefuserSharedView {
  gameId: typeof DEFUSER_ID;
  phase: DefuserPhase;
  version: number;
  settings: DefuserSettings;
  me: string;
  editionLabel: string;
  roster: DefuserRosterEntry[];
  sheetIndex: Array<{ sheet: SheetId; holders: string[] }>;
  faults: number;
  solved: Record<PanelId, boolean>;
  briefingDeadlineAt: number | null;
  deadlineAt: number | null;
  result: CoopResult | null;
}

export interface DefuserTriedEntries {
  fuse: number[];
  glyph: Array<{ first: number; second: number | null }>;
  valve: Array<{ level: number; vent: Vent }>;
}

/**
 * Per-recipient views (spec section 18). Types only in this phase: the plug-in that builds
 * them comes next.
 */
export type DefuserPlayerView =
  | (DefuserSharedView & {
      kind: 'operator';
      charge: DefuserCharge;
      cutLines: number[];
      litKey: number | null;
      tried: DefuserTriedEntries;
    })
  | (DefuserSharedView & { kind: 'analyst'; sheets: SheetData[] })
  | (DefuserSharedView & { kind: 'inactive'; canRejoin: boolean })
  | (DefuserSharedView & {
      kind: 'debrief';
      charge: DefuserCharge;
      sheets: SheetData[];
      solution: DefuserSolution;
      moves: DefuserMove[];
    });

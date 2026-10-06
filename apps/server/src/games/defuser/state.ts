import {
  SHEET_IDS,
  type AnalystLetter,
  type CoopPlayerStatus,
  type CoopResult,
  type DefuserMove,
  type DefuserPhase,
  type DefuserRole,
  type DefuserSettings,
  type DefuserTriedEntries,
  type PanelId,
  type SheetId,
} from '@rivalrush/shared';
import type { Edition } from './edition.js';

/** One seated player of a Defuser game (spec sections 3, 4 and 14). */
export interface DefuserPlayer {
  id: string;
  /** Role at game start. */
  startRole: DefuserRole;
  /** Current role while active; the last role held while inactive (for match history). */
  role: DefuserRole;
  /** Analyst letter, kept for the whole game. A starting Operator has none until a rejoin. */
  letter: AnalystLetter | null;
  status: CoopPlayerStatus;
  ready: boolean;
  /** Sheet ids a rejoin gives copies of (section 14, rejoin rule). */
  rejoinSheets: SheetId[];
  rejoined: boolean;
}

/**
 * Full server-side state. Holds the seed, the whole edition and the solution, so it never
 * leaves the server: every outbound path goes through a view in views.ts.
 */
export interface DefuserState {
  version: number;
  phase: DefuserPhase;
  settings: DefuserSettings;
  seed: string;
  generatorVersion: number;
  edition: Edition;
  /** Seat order at game start. */
  players: DefuserPlayer[];
  operatorId: string;
  /** Analysts at game start; fixes the countdown length (section 11). */
  analystCount: number;
  /** Current holders of each sheet, by user id. */
  holders: Record<SheetId, string[]>;
  briefingDeadlineAt: number | null;
  armedAt: number | null;
  deadlineAt: number | null;
  faults: number;
  solved: Record<PanelId, boolean>;
  cutLines: number[];
  /** The correctly pressed first Glyph key, while the second is pending. */
  litKey: number | null;
  tried: DefuserTriedEntries;
  moves: DefuserMove[];
  result: CoopResult | null;
  startedAt: number;
  endedAt: number | null;
}

export const LIVE_PHASES: readonly DefuserPhase[] = ['BRIEFING', 'ARMED'];

export const isLive = (s: DefuserState) => LIVE_PHASES.includes(s.phase);

export function playerOf(s: DefuserState, id: string): DefuserPlayer | undefined {
  return s.players.find((p) => p.id === id);
}

export const isActive = (p: DefuserPlayer) => p.status === 'active';

export function activePlayers(s: DefuserState): DefuserPlayer[] {
  return s.players.filter(isActive);
}

/** Active Analysts, earliest letter first. */
export function activeAnalysts(s: DefuserState): DefuserPlayer[] {
  return s.players
    .filter((p) => isActive(p) && p.role === 'analyst')
    .sort((a, b) => (a.letter ?? 'Z').localeCompare(b.letter ?? 'Z'));
}

/** Sheets a player currently holds, in catalogue order. */
export function sheetsHeldBy(s: DefuserState, id: string): SheetId[] {
  return SHEET_IDS.filter((sheet) => s.holders[sheet].includes(id));
}

/** Ms since arming, for move timestamps (0 during the briefing). */
export function sinceArmed(s: DefuserState, now: number): number {
  return s.armedAt === null ? 0 : Math.max(0, now - s.armedAt);
}

export const LETTERS: readonly AnalystLetter[] = ['A', 'B', 'C', 'D'];

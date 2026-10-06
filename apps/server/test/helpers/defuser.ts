import {
  SHEET_IDS,
  type DefuserPlayerAction,
  type DefuserSolution,
  type SheetId,
} from '@rivalrush/shared';
import { expect } from 'vitest';
import { generateEdition } from '../../src/games/defuser/edition.js';
import { createDefuser, type DefuserDefinition } from '../../src/games/defuser/game.js';
import type { DefuserState } from '../../src/games/defuser/state.js';
import type { ApplyResult, GameEvent, SystemAction } from '../../src/games/engine/types.js';
import { seededRandom } from './random.js';

/** Test-only seed tooling (spec section 18: solutionOf(seed) lives in test code only). */
export const SEED = '0123456789abcdef0123456789abcdef';

export function solutionOf(seed: string, analystCount: number): DefuserSolution {
  return generateEdition({ seed, analystCount }).solution;
}

export const T0 = new Date('2026-10-06T12:00:00Z').getTime();
export const BRIEF_MS = 20_000;
export const PLAYERS = ['p1', 'p2', 'p3', 'p4'] as const;

export interface Game {
  def: DefuserDefinition;
  state: DefuserState;
}

/** A fresh game: `n` players, the Operator at `first` (seat index). */
export function start(n: number, opts: { first?: number; seed?: string } = {}): Game {
  const def = createDefuser({ fixedSeed: opts.seed ?? SEED });
  const state = def.createInitialState(
    { difficulty: 'normal' },
    {
      players: PLAYERS.slice(0, n),
      firstPlayerIndex: opts.first ?? 0,
      now: T0,
      random: seededRandom(7),
    },
  );
  return { def, state };
}

export function apply(
  g: Game,
  by: string | SystemAction,
  action: DefuserPlayerAction | null,
  now: number,
): ApplyResult<DefuserState> {
  const actor =
    typeof by === 'string'
      ? { kind: 'player' as const, playerId: by }
      : { kind: 'system' as const };
  return g.def.applyAction(g.state, actor, typeof by === 'string' ? action : by, {
    now,
    random: () => 0.5,
  });
}

/** Applies and expects acceptance with exactly +1 version; advances `g`. Returns the events. */
export function ok(
  g: Game,
  by: string | SystemAction,
  action: DefuserPlayerAction | null,
  now: number,
): GameEvent[] {
  const before = g.state.version;
  const r = apply(g, by, action, now);
  if (!r.ok) throw new Error(`refused: ${r.error.code} ${JSON.stringify(r.error.details)}`);
  expect(r.state.version).toBe(before + 1);
  g.state = r.state;
  return r.events;
}

/** Applies and expects a refusal that changes nothing. Returns `code` or `code/rule`. */
export function refused(
  g: Game,
  by: string | SystemAction,
  action: DefuserPlayerAction | null,
  now: number,
): string {
  const snapshot = structuredClone(g.state);
  const r = apply(g, by, action, now);
  if (r.ok) throw new Error('expected a refusal');
  expect(g.state).toEqual(snapshot);
  const rule = (r.error.details as { rule?: string } | undefined)?.rule;
  return rule ? `${r.error.code}/${rule}` : r.error.code;
}

export const types = (events: GameEvent[]) => events.map((e) => e.type);

/** Everyone active readies up; returns the arming time. */
export function armAll(g: Game, at = T0 + 1000): number {
  for (const p of g.state.players)
    if (p.status === 'active' && !p.ready) ok(g, p.id, { type: 'READY' }, at);
  expect(g.state.phase).toBe('ARMED');
  return at;
}

export const operator = (g: Game) => g.state.operatorId;
export const analysts = (g: Game) =>
  g.state.players
    .filter((p) => p.status === 'active' && p.role === 'analyst')
    .sort((a, b) => a.letter!.localeCompare(b.letter!))
    .map((p) => p.id);

export const sol = (g: Game) => g.state.edition.solution;

export const wrongLine = (g: Game) =>
  [1, 2, 3, 4, 5].find((l) => l !== sol(g).fuse.line && !g.state.cutLines.includes(l))!;

/** Every sheet has at least one active Analyst holder, and only active Analysts hold sheets. */
export function expectEverySheetHeld(g: Game): void {
  const active = new Set(analysts(g));
  for (const sheet of SHEET_IDS) {
    expect(g.state.holders[sheet].length, `${sheet} has no holder`).toBeGreaterThan(0);
    for (const h of g.state.holders[sheet])
      expect(active.has(h), `${sheet} held by ${h}`).toBe(true);
  }
}

export const held = (g: Game, id: string): SheetId[] =>
  SHEET_IDS.filter((s) => g.state.holders[s].includes(id));

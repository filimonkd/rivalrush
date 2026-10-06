import {
  DEFUSER_ID,
  DEFUSER_LIMITS,
  PANEL_IDS,
  SHEET_IDS,
  defuserActionSchema,
  defuserSettingsSchema,
  errorPayload,
  type CoopPlayerRecord,
  type DefuserInput,
  type DefuserPlayerAction,
  type DefuserPlayerView,
  type DefuserPublicView,
  type DefuserSettings,
  type PanelId,
  type SheetId,
} from '@rivalrush/shared';
import type {
  Actor,
  ApplyContext,
  ApplyResult,
  CreateContext,
  Deadline,
  GameDefinition,
  GameEvent,
} from '../engine/types.js';
import { dropOut, rejoin } from './dropout.js';
import { GENERATOR_VERSION, generateEdition } from './edition.js';
import { isSeed, seedFromRandom } from './prng.js';
import {
  LETTERS,
  activePlayers,
  isActive,
  isLive,
  playerOf,
  sinceArmed,
  type DefuserPlayer,
  type DefuserState,
} from './state.js';
import { arm, endGame } from './transitions.js';
import { playerView, publicView } from './views.js';

/**
 * Defuser state machine (spec sections 8–14). Co-op: one Operator and 1–3 Analysts against the
 * countdown.
 *
 *   BRIEFING ──everyone active ready / 20 s──▶ ARMED
 *   ARMED ──third panel solved──▶ DEFUSED,  ──third fault / countdown──▶ DETONATED
 *   BRIEFING | ARMED ──fewer than 2 active──▶ ABANDONED
 *
 * Every accepted action bumps the version by exactly 1. A refused one changes nothing.
 */

type Fail = Extract<ApplyResult<DefuserState>, { ok: false }>;

function fail(code: Parameters<typeof errorPayload>[0], message?: string, rule?: string): Fail {
  return { ok: false, error: errorPayload(code, message, rule ? { rule } : undefined) };
}

const REFUSALS = {
  inactive: () =>
    fail('INVALID_ACTION', "You're out of this game. Rejoin to help the team.", 'inactive'),
  notInactive: () => fail('INVALID_ACTION', "You're already in this game.", 'not_inactive'),
  notOperator: () => fail('INVALID_ACTION', 'Only the Operator can do that.', 'not_operator'),
  alreadyReady: () => fail('INVALID_ACTION', "You're already ready.", 'already_ready'),
  panelSolved: () => fail('INVALID_ACTION', 'That panel is already solved.', 'panel_solved'),
  lineCut: () => fail('INVALID_ACTION', 'That line is already cut.', 'line_cut'),
  keyLit: () => fail('INVALID_ACTION', 'That key is already lit.', 'key_lit'),
  alreadyTried: () => fail('INVALID_ACTION', 'Already tried.', 'already_tried'),
};

const DEVICE_INPUTS: readonly DefuserPlayerAction['type'][] = [
  'CUT_LINE',
  'PRESS_GLYPH',
  'SET_VALVE',
];

function accept(next: DefuserState, events: GameEvent[]): ApplyResult<DefuserState> {
  next.version++;
  return { ok: true, state: next, events };
}

// ---------------------------------------------------------------- creation

function createState(
  settings: DefuserSettings,
  ctx: CreateContext,
  fixedSeed: string | undefined,
): DefuserState {
  const n = ctx.players.length;
  if (n < DEFUSER_LIMITS.minPlayers || n > DEFUSER_LIMITS.maxPlayers) {
    throw new Error(`Defuser needs 2–4 players, got ${n}`);
  }
  const opIndex = ctx.firstPlayerIndex % n;
  const seed = fixedSeed ?? seedFromRandom(ctx.random);
  const analystCount = n - 1;
  const edition = generateEdition({ seed, analystCount, difficulty: settings.difficulty });

  // Analyst letters follow seat order after the Operator, wrapping around (section 15).
  const players: DefuserPlayer[] = ctx.players.map((id) => ({
    id,
    startRole: 'analyst',
    role: 'analyst',
    letter: null,
    status: 'active',
    ready: false,
    rejoinSheets: [],
    rejoined: false,
  }));
  const op = players[opIndex]!;
  op.startRole = 'operator';
  op.role = 'operator';
  const holders = Object.fromEntries(SHEET_IDS.map((id) => [id, [] as string[]])) as Record<
    SheetId,
    string[]
  >;
  for (let k = 0; k < analystCount; k++) {
    const p = players[(opIndex + 1 + k) % n]!;
    p.letter = LETTERS[k]!;
    p.rejoinSheets = [...edition.assignment[k]!];
    for (const sheet of p.rejoinSheets) holders[sheet].push(p.id);
  }

  return {
    version: 1,
    phase: 'BRIEFING',
    settings: { ...settings },
    seed,
    generatorVersion: GENERATOR_VERSION,
    edition,
    players,
    operatorId: op.id,
    analystCount,
    holders,
    briefingDeadlineAt: ctx.now + DEFUSER_LIMITS.briefingSeconds * 1000,
    armedAt: null,
    deadlineAt: null,
    faults: 0,
    solved: { fuse: false, glyph: false, valve: false },
    cutLines: [],
    litKey: null,
    tried: { fuse: [], glyph: [], valve: [] },
    moves: [],
    result: null,
    startedAt: ctx.now,
    endedAt: null,
  };
}

// ---------------------------------------------------------------- system actions

function applyTimeout(s: DefuserState, now: number): ApplyResult<DefuserState> {
  const events: GameEvent[] = [];
  if (s.phase === 'BRIEFING') {
    if (s.briefingDeadlineAt === null || now < s.briefingDeadlineAt) {
      return fail('INVALID_ACTION', 'The briefing is not over yet.');
    }
    const next = structuredClone(s);
    // The countdown starts at the briefing deadline itself, however late the timer fired.
    arm(next, s.briefingDeadlineAt, events);
    return accept(next, events);
  }
  if (s.deadlineAt === null || now < s.deadlineAt) {
    return fail('INVALID_ACTION', 'The countdown is not over yet.');
  }
  const next = structuredClone(s);
  endGame(next, 'timer', s.deadlineAt, events);
  return accept(next, events);
}

function applyDropOut(
  s: DefuserState,
  playerId: string,
  status: 'timed_out' | 'left',
  now: number,
): ApplyResult<DefuserState> {
  const p = playerOf(s, playerId);
  if (!p) return fail('NOT_ROOM_MEMBER');
  // Step 0: already inactive → refused, no change, no version bump, no event.
  if (!isActive(p)) return fail('INVALID_ACTION', undefined, 'already_inactive');
  const next = structuredClone(s);
  const events: GameEvent[] = [];
  dropOut(next, playerOf(next, playerId)!, status, now, events);
  return accept(next, events);
}

// ---------------------------------------------------------------- player actions

function recordInput(
  s: DefuserState,
  playerId: string,
  panel: PanelId,
  input: DefuserInput,
  ok: boolean,
  now: number,
): void {
  s.moves.push({ kind: 'input', playerId, panel, input, ok, at: now, atMs: sinceArmed(s, now) });
}

function solve(
  s: DefuserState,
  playerId: string,
  panel: PanelId,
  now: number,
  events: GameEvent[],
): void {
  s.solved[panel] = true;
  const solvedCount = PANEL_IDS.filter((p) => s.solved[p]).length;
  events.push({ type: 'panel_solved', actorId: playerId, data: { panel, solvedCount } });
  if (solvedCount === PANEL_IDS.length) endGame(s, 'defused', now, events);
}

function fault(
  s: DefuserState,
  playerId: string,
  panel: PanelId,
  input: DefuserInput,
  now: number,
  events: GameEvent[],
): void {
  s.faults++;
  events.push({
    type: 'fault',
    actorId: playerId,
    data: { panel, faults: s.faults, input: { ...input } },
  });
  if (s.faults >= DEFUSER_LIMITS.maxFaults) endGame(s, 'faults', now, events);
}

function applyCut(s: DefuserState, by: string, line: number, now: number) {
  if (s.solved.fuse) return REFUSALS.panelSolved();
  if (s.cutLines.includes(line)) return REFUSALS.lineCut();
  const next = structuredClone(s);
  const events: GameEvent[] = [];
  const ok = line === s.edition.solution.fuse.line;
  next.cutLines.push(line);
  recordInput(next, by, 'fuse', { line }, ok, now);
  if (ok) solve(next, by, 'fuse', now, events);
  else {
    next.tried.fuse.push(line);
    fault(next, by, 'fuse', { line }, now, events);
  }
  return accept(next, events);
}

function applyPress(s: DefuserState, by: string, key: number, now: number) {
  if (s.solved.glyph) return REFUSALS.panelSolved();
  const { first, second } = s.edition.solution.glyph;
  const lit = s.litKey;
  if (lit === key) return REFUSALS.keyLit();
  const known = s.tried.glyph.some((e) =>
    lit === null ? e.first === key && e.second === null : e.first === lit && e.second === key,
  );
  if (known) return REFUSALS.alreadyTried();
  const next = structuredClone(s);
  const events: GameEvent[] = [];
  const ok = lit === null ? key === first : key === second;
  recordInput(next, by, 'glyph', { key }, ok, now);
  if (ok && lit === null) next.litKey = key;
  else if (ok) {
    next.litKey = null;
    solve(next, by, 'glyph', now, events);
  } else {
    // A wrong key clears the entry; the first key must be pressed again (no fault for that).
    next.tried.glyph.push({ first: lit ?? key, second: lit === null ? null : key });
    next.litKey = null;
    fault(next, by, 'glyph', { key }, now, events);
  }
  return accept(next, events);
}

function applyValve(
  s: DefuserState,
  by: string,
  level: number,
  vent: 'seal' | 'vent',
  now: number,
) {
  if (s.solved.valve) return REFUSALS.panelSolved();
  if (s.tried.valve.some((e) => e.level === level && e.vent === vent)) {
    return REFUSALS.alreadyTried();
  }
  const next = structuredClone(s);
  const events: GameEvent[] = [];
  const answer = s.edition.solution.valve;
  const ok = level === answer.level && vent === answer.vent;
  recordInput(next, by, 'valve', { level, vent }, ok, now);
  if (ok) solve(next, by, 'valve', now, events);
  else {
    next.tried.valve.push({ level, vent });
    fault(next, by, 'valve', { level, vent }, now, events);
  }
  return accept(next, events);
}

/** Validation steps 12–16 of spec section 9, in that order; the first failure wins. */
function applyPlayer(
  s: DefuserState,
  playerId: string,
  action: DefuserPlayerAction,
  now: number,
): ApplyResult<DefuserState> {
  const me = playerOf(s, playerId);
  if (!me) return fail('NOT_ROOM_MEMBER');
  const device = DEVICE_INPUTS.includes(action.type);

  // 12. Phase.
  if (action.type === 'READY' && s.phase !== 'BRIEFING') {
    return fail('GAME_ALREADY_STARTED', 'The Charge is already armed.');
  }
  if ((device || action.type === 'REJOIN') && s.phase === 'BRIEFING') {
    return fail('GAME_NOT_STARTED', 'Wait until the Charge is armed.');
  }
  // Defensive: the platform applies the detonation deadline before any action.
  if (s.deadlineAt !== null && now >= s.deadlineAt) return fail('GAME_FINISHED');

  // 13. Actor status.
  if (action.type === 'REJOIN') {
    if (isActive(me)) return REFUSALS.notInactive();
  } else if (!isActive(me)) return REFUSALS.inactive();

  // 14. Role.
  if (device && me.role !== 'operator') return REFUSALS.notOperator();

  // 15–16. Action state and known-wrong entries.
  switch (action.type) {
    case 'READY': {
      if (me.ready) return REFUSALS.alreadyReady();
      const next = structuredClone(s);
      const events: GameEvent[] = [];
      playerOf(next, playerId)!.ready = true;
      if (activePlayers(next).every((p) => p.ready)) arm(next, now, events);
      return accept(next, events);
    }
    case 'CUT_LINE':
      return applyCut(s, playerId, action.line, now);
    case 'PRESS_GLYPH':
      return applyPress(s, playerId, action.key, now);
    case 'SET_VALVE':
      return applyValve(s, playerId, action.level, action.vent, now);
    case 'REJOIN': {
      // Only a timed-out player can rejoin; someone who left has no seat (platform refuses).
      if (me.status !== 'timed_out') return REFUSALS.inactive();
      const next = structuredClone(s);
      const events: GameEvent[] = [];
      rejoin(next, playerOf(next, playerId)!, now, events);
      return accept(next, events);
    }
  }
}

// ---------------------------------------------------------------- definition

export interface DefuserOptions {
  /**
   * Dev/test only: every game in this process uses this seed (spec section 18). Never set in
   * production; config refuses to start if it is.
   */
  fixedSeed?: string;
}

export type DefuserDefinition = GameDefinition<
  DefuserState,
  DefuserSettings,
  DefuserPlayerView,
  DefuserPublicView
>;

export function createDefuser(opts: DefuserOptions = {}): DefuserDefinition {
  if (opts.fixedSeed !== undefined && !isSeed(opts.fixedSeed)) {
    throw new RangeError('fixedSeed must be 32 lowercase hex characters');
  }
  return {
    id: DEFUSER_ID,
    name: 'Defuser',
    minPlayers: DEFUSER_LIMITS.minPlayers,
    maxPlayers: DEFUSER_LIMITS.maxPlayers,
    // There are no turns: every action is checked against the state at apply time.
    versionIndependentActions: ['READY', 'CUT_LINE', 'PRESS_GLYPH', 'SET_VALVE', 'REJOIN'],

    parseSettings(input) {
      return defuserSettingsSchema.parse(input ?? {});
    },

    parseAction(input) {
      const parsed = defuserActionSchema.safeParse(input);
      return parsed.success ? parsed.data : null;
    },

    createInitialState(settings, ctx) {
      return createState(settings, ctx, opts.fixedSeed);
    },

    applyAction(state, actor: Actor, rawAction, ctx: ApplyContext) {
      if (!isLive(state)) return fail('GAME_FINISHED');
      if (actor.kind === 'system') {
        const action = rawAction as { type: string; playerId?: string };
        switch (action.type) {
          case '$TIMEOUT':
            return applyTimeout(state, ctx.now);
          case '$ABANDON':
            return applyDropOut(state, action.playerId ?? '', 'timed_out', ctx.now);
          case '$FORFEIT':
            return applyDropOut(state, action.playerId ?? '', 'left', ctx.now);
          default:
            return fail('INVALID_ACTION');
        }
      }
      const parsed = defuserActionSchema.safeParse(rawAction);
      if (!parsed.success) return fail('INVALID_ACTION', 'Unknown move.');
      return applyPlayer(state, actor.playerId, parsed.data, ctx.now);
    },

    getPlayerView: playerView,
    getPublicView: publicView,

    getResult(state) {
      return state.result ? { ...state.result, individual: { ...state.result.individual } } : null;
    },

    getVersion(state) {
      return state.version;
    },

    getNextDeadline(state): Deadline | null {
      if (state.phase === 'BRIEFING' && state.briefingDeadlineAt !== null) {
        return { at: state.briefingDeadlineAt, action: { type: '$TIMEOUT' } };
      }
      if (state.phase === 'ARMED' && state.deadlineAt !== null) {
        return { at: state.deadlineAt, action: { type: '$TIMEOUT' } };
      }
      return null;
    },

    getMoves(state) {
      return state.moves.map((m) => structuredClone(m));
    },

    getCoopPlayerRecords(state) {
      const records: Record<string, CoopPlayerRecord> = {};
      for (const p of state.players) {
        records[p.id] = {
          startRole: p.startRole,
          finalRole: p.role,
          letter: p.letter,
          finalStatus: p.status,
          rejoined: p.rejoined,
        };
      }
      return records;
    },

    getGeneratorInfo(state) {
      return { version: state.generatorVersion, seed: state.seed };
    },
  };
}

/** The production plug-in (random seed per game). Not in the live registry yet. */
export const defuser = createDefuser();

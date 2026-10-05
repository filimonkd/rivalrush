import {
  CC_LIMITS,
  ccActionSchema,
  ccSettingsSchema,
  checkPattern,
  COLOR_CIPHER_ID,
  errorPayload,
  type CcEndReason,
  type CcMove,
  type CcPhase,
  type CcPlayerPublic,
  type CcPlayerView,
  type CcPublicView,
  type CcSettings,
  type GameResult,
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
import { generatePattern, scorePattern } from './rules.js';

/**
 * Color Cipher state machine (see docs/color-cipher.md). Same competitive structure as Crack the
 * Code, with color patterns (repeats allowed) and Exact/Close feedback:
 *
 *   SETUP ──both patterns locked / setup deadline──▶ PLAYING
 *   PLAYING ──first player cracks──▶ LAST_CHANCE ──second player's reply──▶ FINISHED
 *   PLAYING ──second player cracks / both out of turns──▶ FINISHED
 *   any live phase ──forfeit──▶ FINISHED,  ──grace expired──▶ ABANDONED
 */

interface CcPlayerState {
  id: string;
  secret: string | null;
  autoSecret: boolean;
  /** Turns used, including timed-out turns. Capped at settings.maxGuesses. */
  turnsUsed: number;
  cracked: boolean;
}

export interface CcState {
  version: number;
  phase: CcPhase;
  settings: CcSettings;
  setupSeconds: number;
  players: [CcPlayerState, CcPlayerState];
  firstPlayerId: string;
  currentTurn: string | null;
  setupDeadlineAt: number | null;
  turnStartedAt: number | null;
  turnDeadlineAt: number | null;
  moves: CcMove[];
  result: GameResult | null;
  startedAt: number;
  endedAt: number | null;
}

const LIVE_PHASES: readonly CcPhase[] = ['SETUP', 'PLAYING', 'LAST_CHANCE'];

function fail<S>(
  code: Parameters<typeof errorPayload>[0],
  message?: string,
  details?: Record<string, unknown>,
): ApplyResult<S> {
  return { ok: false, error: errorPayload(code, message, details) };
}

function clone(state: CcState): CcState {
  return structuredClone(state);
}

function playerOf(state: CcState, id: string): CcPlayerState | undefined {
  return state.players.find((p) => p.id === id);
}

function opponentOf(state: CcState, id: string): CcPlayerState {
  const other = state.players.find((p) => p.id !== id);
  if (!other) throw new Error('opponent missing');
  return other;
}

function startTurn(state: CcState, playerId: string, now: number): void {
  state.currentTurn = playerId;
  state.turnStartedAt = now;
  state.turnDeadlineAt = now + state.settings.turnSeconds * 1000;
}

function end(
  state: CcState,
  now: number,
  outcome: 'win' | 'draw',
  winnerId: string | null,
  reason: CcEndReason,
  events: GameEvent[],
  extra: Record<string, unknown> = {},
): void {
  state.phase = reason === 'abandoned' ? 'ABANDONED' : 'FINISHED';
  state.result = { outcome, winnerId, reason };
  state.currentTurn = null;
  state.turnStartedAt = null;
  state.turnDeadlineAt = null;
  state.setupDeadlineAt = null;
  state.endedAt = now;
  events.push({ type: 'game_over', actorId: null, data: { outcome, winnerId, reason, ...extra } });
}

function beginPlaying(state: CcState, now: number, events: GameEvent[]): void {
  state.phase = 'PLAYING';
  state.setupDeadlineAt = null;
  startTurn(state, state.firstPlayerId, now);
  events.push({
    type: 'playing_started',
    actorId: null,
    data: { firstPlayerId: state.firstPlayerId },
  });
}

/** After `moverId` used a turn (guess or timeout), decide what happens next. */
function afterTurn(state: CcState, moverId: string, now: number, events: GameEvent[]): void {
  const mover = playerOf(state, moverId)!;
  const other = opponentOf(state, moverId);
  const isFirst = moverId === state.firstPlayerId;

  if (state.phase === 'LAST_CHANCE') {
    // Only the second player moves in LAST_CHANCE; the first player has already cracked.
    if (mover.cracked) end(state, now, 'draw', null, 'both_cracked', events);
    else end(state, now, 'win', other.id, 'cracked', events);
    return;
  }

  if (isFirst) {
    if (mover.cracked) {
      // Equalizer: the second player has used one turn fewer, so they always have one left.
      state.phase = 'LAST_CHANCE';
      startTurn(state, other.id, now);
      events.push({ type: 'last_chance', actorId: other.id });
      return;
    }
    startTurn(state, other.id, now);
    return;
  }

  // Second player moved: both players have now used the same number of turns.
  if (mover.cracked) {
    end(state, now, 'win', mover.id, 'cracked', events);
    return;
  }
  if (
    mover.turnsUsed >= state.settings.maxGuesses &&
    other.turnsUsed >= state.settings.maxGuesses
  ) {
    end(state, now, 'draw', null, 'out_of_guesses', events);
    return;
  }
  startTurn(state, other.id, now);
}

function applyTimeout(state: CcState, ctx: ApplyContext): ApplyResult<CcState> {
  const events: GameEvent[] = [];
  if (state.phase === 'SETUP') {
    if (state.setupDeadlineAt === null || ctx.now < state.setupDeadlineAt) {
      return fail('INVALID_ACTION', 'Setup timer has not expired.');
    }
    const next = clone(state);
    for (const p of next.players) {
      if (p.secret === null) {
        p.secret = generatePattern(
          next.settings.patternLength,
          next.settings.colorCount,
          ctx.random,
        );
        p.autoSecret = true;
        events.push({ type: 'secret_locked', actorId: p.id, data: { auto: true } });
      }
    }
    next.version++;
    beginPlaying(next, ctx.now, events);
    return { ok: true, state: next, events };
  }
  if (state.phase === 'PLAYING' || state.phase === 'LAST_CHANCE') {
    if (
      state.turnDeadlineAt === null ||
      ctx.now < state.turnDeadlineAt ||
      state.currentTurn === null
    ) {
      return fail('INVALID_ACTION', 'Turn timer has not expired.');
    }
    const next = clone(state);
    const moverId = next.currentTurn!;
    const mover = playerOf(next, moverId)!;
    mover.turnsUsed++;
    next.moves.push({
      playerId: moverId,
      guess: null,
      exact: 0,
      partial: 0,
      timedOut: true,
      at: ctx.now,
      turnNumber: mover.turnsUsed,
    });
    events.push({ type: 'turn_timed_out', actorId: moverId });
    next.version++;
    afterTurn(next, moverId, ctx.now, events);
    return { ok: true, state: next, events };
  }
  return fail('GAME_FINISHED');
}

function applyForfeit(
  state: CcState,
  playerId: string,
  reason: 'forfeit' | 'abandoned',
  now: number,
): ApplyResult<CcState> {
  if (!playerOf(state, playerId)) return fail('NOT_ROOM_MEMBER');
  const next = clone(state);
  const events: GameEvent[] = [];
  next.version++;
  end(next, now, 'win', opponentOf(next, playerId).id, reason, events, { loserId: playerId });
  return { ok: true, state: next, events };
}

function patternMessage(check: 'length' | 'color', length: number): string {
  if (check === 'length') return `Pick exactly ${length} colors.`;
  return 'Use the colors on the palette.';
}

function applySetSecret(
  state: CcState,
  playerId: string,
  pattern: string,
  now: number,
): ApplyResult<CcState> {
  if (state.phase !== 'SETUP')
    return fail('GAME_ALREADY_STARTED', 'Patterns are already locked in.');
  if (state.setupDeadlineAt !== null && now >= state.setupDeadlineAt) {
    return fail('INVALID_ACTION', 'Setup time is over.');
  }
  const me = playerOf(state, playerId)!;
  if (me.secret !== null) return fail('SECRET_ALREADY_SET', 'Your pattern is already locked in.');
  const { patternLength, colorCount } = state.settings;
  const check = checkPattern(pattern, patternLength, colorCount);
  if (check !== 'ok') {
    return fail('INVALID_SECRET', patternMessage(check, patternLength), { rule: check });
  }
  const next = clone(state);
  const events: GameEvent[] = [{ type: 'secret_locked', actorId: playerId, data: { auto: false } }];
  playerOf(next, playerId)!.secret = pattern;
  next.version++;
  if (next.players.every((p) => p.secret !== null)) beginPlaying(next, now, events);
  return { ok: true, state: next, events };
}

function applyGuess(
  state: CcState,
  playerId: string,
  guess: string,
  now: number,
): ApplyResult<CcState> {
  if (state.phase === 'SETUP')
    return fail('GAME_NOT_STARTED', 'Wait until both patterns are locked in.');
  if (state.currentTurn !== playerId) return fail('NOT_YOUR_TURN');
  if (state.turnDeadlineAt !== null && now >= state.turnDeadlineAt) {
    return fail('NOT_YOUR_TURN', 'Your time ran out.', { reason: 'turn_expired' });
  }
  const { patternLength, colorCount } = state.settings;
  const check = checkPattern(guess, patternLength, colorCount);
  if (check !== 'ok')
    return fail('INVALID_GUESS', patternMessage(check, patternLength), { rule: check });
  if (state.moves.some((m) => m.playerId === playerId && m.guess === guess))
    return fail('DUPLICATE_GUESS', 'You already tried that pattern.');
  const me = playerOf(state, playerId)!;
  if (me.turnsUsed >= state.settings.maxGuesses) return fail('INVALID_ACTION', 'No guesses left.');

  const next = clone(state);
  const mover = playerOf(next, playerId)!;
  const target = opponentOf(next, playerId);
  const { exact, partial } = scorePattern(target.secret!, guess);
  mover.turnsUsed++;
  if (exact === patternLength) mover.cracked = true;
  next.moves.push({
    playerId,
    guess,
    exact,
    partial,
    timedOut: false,
    at: now,
    turnNumber: mover.turnsUsed,
  });
  const events: GameEvent[] = [
    {
      type: 'guess_made',
      actorId: playerId,
      data: { guess, exact, partial, cracked: mover.cracked },
    },
  ];
  next.version++;
  afterTurn(next, playerId, now, events);
  return { ok: true, state: next, events };
}

function publicPlayers(state: CcState): CcPlayerPublic[] {
  return state.players.map((p) => ({
    userId: p.id,
    hasSecret: p.secret !== null,
    turnsUsed: p.turnsUsed,
    guessesLeft: state.settings.maxGuesses - p.turnsUsed,
    cracked: p.cracked,
  }));
}

function publicView(state: CcState): CcPublicView {
  return {
    gameId: COLOR_CIPHER_ID,
    phase: state.phase,
    version: state.version,
    settings: { ...state.settings },
    players: publicPlayers(state),
    firstPlayerId: state.firstPlayerId,
    currentTurn: state.currentTurn,
    setupDeadlineAt: state.setupDeadlineAt,
    turnStartedAt: state.turnStartedAt,
    turnDeadlineAt: state.turnDeadlineAt,
    moves: state.moves.map((m) => ({ ...m })),
    result: state.result ? { ...state.result } : null,
  };
}

export const colorCipher: GameDefinition<CcState, CcSettings, CcPlayerView, CcPublicView> = {
  id: COLOR_CIPHER_ID,
  name: 'Color Cipher',
  minPlayers: 2,
  maxPlayers: 2,
  // A pattern is independent of the opponent's moves; giving up is always allowed.
  versionIndependentActions: ['SET_SECRET', 'FORFEIT'],

  parseSettings(input) {
    return ccSettingsSchema.parse(input ?? {});
  },

  parseAction(input) {
    const parsed = ccActionSchema.safeParse(input);
    return parsed.success ? parsed.data : null;
  },

  createInitialState(settings, ctx: CreateContext) {
    if (ctx.players.length !== 2) throw new Error('Color Cipher needs exactly 2 players');
    const firstPlayerId = ctx.players[ctx.firstPlayerIndex % 2]!;
    const mk = (id: string): CcPlayerState => ({
      id,
      secret: null,
      autoSecret: false,
      turnsUsed: 0,
      cracked: false,
    });
    return {
      version: 1,
      phase: 'SETUP',
      settings: { ...settings },
      setupSeconds: CC_LIMITS.setupSeconds,
      players: [mk(ctx.players[0]!), mk(ctx.players[1]!)],
      firstPlayerId,
      currentTurn: null,
      setupDeadlineAt: ctx.now + CC_LIMITS.setupSeconds * 1000,
      turnStartedAt: null,
      turnDeadlineAt: null,
      moves: [],
      result: null,
      startedAt: ctx.now,
      endedAt: null,
    };
  },

  applyAction(state, actor: Actor, rawAction, ctx) {
    if (!LIVE_PHASES.includes(state.phase)) return fail('GAME_FINISHED');

    if (actor.kind === 'system') {
      const action = rawAction as { type: string; playerId?: string };
      switch (action.type) {
        case '$TIMEOUT':
          return applyTimeout(state, ctx);
        case '$ABANDON':
          return applyForfeit(state, action.playerId ?? '', 'abandoned', ctx.now);
        case '$FORFEIT':
          return applyForfeit(state, action.playerId ?? '', 'forfeit', ctx.now);
        default:
          return fail('INVALID_ACTION');
      }
    }

    if (!playerOf(state, actor.playerId)) return fail('NOT_ROOM_MEMBER');
    const parsed = ccActionSchema.safeParse(rawAction);
    if (!parsed.success) return fail('INVALID_ACTION', 'Unknown move.');
    const action = parsed.data;
    switch (action.type) {
      case 'SET_SECRET':
        return applySetSecret(state, actor.playerId, action.pattern, ctx.now);
      case 'GUESS':
        return applyGuess(state, actor.playerId, action.pattern, ctx.now);
      case 'FORFEIT':
        return applyForfeit(state, actor.playerId, 'forfeit', ctx.now);
    }
  },

  getPlayerView(state, playerId) {
    const me = playerOf(state, playerId);
    const over = !LIVE_PHASES.includes(state.phase);
    const opponent = me ? opponentOf(state, playerId) : undefined;
    return {
      ...publicView(state),
      me: playerId,
      mySecret: me?.secret ?? null,
      mySecretAutoGenerated: me?.autoSecret ?? false,
      // The opponent's pattern is revealed only once the game is officially over.
      opponentSecret: over && opponent ? opponent.secret : null,
    };
  },

  getPublicView: publicView,

  getResult(state) {
    return state.result ? { ...state.result } : null;
  },

  getVersion(state) {
    return state.version;
  },

  getNextDeadline(state): Deadline | null {
    if (state.phase === 'SETUP' && state.setupDeadlineAt !== null) {
      return { at: state.setupDeadlineAt, action: { type: '$TIMEOUT' } };
    }
    if (
      (state.phase === 'PLAYING' || state.phase === 'LAST_CHANCE') &&
      state.turnDeadlineAt !== null
    ) {
      return { at: state.turnDeadlineAt, action: { type: '$TIMEOUT' } };
    }
    return null;
  },

  getMoves(state) {
    return state.moves.map((m) => ({ ...m }));
  },
};

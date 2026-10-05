import {
  checkCode,
  CRACK_THE_CODE_ID,
  CTC_LIMITS,
  ctcActionSchema,
  ctcSettingsSchema,
  errorPayload,
  type CtcEndReason,
  type CtcMove,
  type CtcPhase,
  type CtcPlayerPublic,
  type CtcPlayerView,
  type CtcPublicView,
  type CtcSettings,
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
import { generateSecret, score } from './rules.js';

/**
 * Crack the Code state machine (see docs/state-machine.md):
 *
 *   SETUP ──both secrets locked / setup deadline──▶ PLAYING
 *   PLAYING ──first player cracks──▶ LAST_CHANCE ──second player's reply──▶ FINISHED
 *   PLAYING ──second player cracks / both out of turns──▶ FINISHED
 *   any live phase ──forfeit──▶ FINISHED,  ──grace expired──▶ ABANDONED
 *
 * "LOBBY" exists only at the room level: no game state is created until the host starts.
 */

interface CtcPlayerState {
  id: string;
  secret: string | null;
  autoSecret: boolean;
  /** Turns used, including timed-out turns. Capped at settings.maxGuesses. */
  turnsUsed: number;
  cracked: boolean;
}

export interface CtcState {
  version: number;
  phase: CtcPhase;
  settings: CtcSettings;
  setupSeconds: number;
  players: [CtcPlayerState, CtcPlayerState];
  firstPlayerId: string;
  currentTurn: string | null;
  setupDeadlineAt: number | null;
  turnStartedAt: number | null;
  turnDeadlineAt: number | null;
  moves: CtcMove[];
  result: GameResult | null;
  startedAt: number;
  endedAt: number | null;
}

const LIVE_PHASES: readonly CtcPhase[] = ['SETUP', 'PLAYING', 'LAST_CHANCE'];

function fail<S>(
  code: Parameters<typeof errorPayload>[0],
  message?: string,
  details?: Record<string, unknown>,
): ApplyResult<S> {
  return { ok: false, error: errorPayload(code, message, details) };
}

function clone(state: CtcState): CtcState {
  return structuredClone(state);
}

function playerOf(state: CtcState, id: string): CtcPlayerState | undefined {
  return state.players.find((p) => p.id === id);
}

function opponentOf(state: CtcState, id: string): CtcPlayerState {
  const other = state.players.find((p) => p.id !== id);
  if (!other) throw new Error('opponent missing');
  return other;
}

function startTurn(state: CtcState, playerId: string, now: number): void {
  state.currentTurn = playerId;
  state.turnStartedAt = now;
  state.turnDeadlineAt = now + state.settings.turnSeconds * 1000;
}

function end(
  state: CtcState,
  now: number,
  outcome: 'win' | 'draw',
  winnerId: string | null,
  reason: CtcEndReason,
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

function beginPlaying(state: CtcState, now: number, events: GameEvent[]): void {
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
function afterTurn(state: CtcState, moverId: string, now: number, events: GameEvent[]): void {
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

function applyTimeout(state: CtcState, ctx: ApplyContext): ApplyResult<CtcState> {
  const events: GameEvent[] = [];
  if (state.phase === 'SETUP') {
    if (state.setupDeadlineAt === null || ctx.now < state.setupDeadlineAt) {
      return fail('INVALID_ACTION', 'Setup timer has not expired.');
    }
    const next = clone(state);
    for (const p of next.players) {
      if (p.secret === null) {
        p.secret = generateSecret(next.settings.codeLength, ctx.random);
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
      bulls: 0,
      cows: 0,
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
  state: CtcState,
  playerId: string,
  reason: 'forfeit' | 'abandoned',
  now: number,
): ApplyResult<CtcState> {
  if (!playerOf(state, playerId)) return fail('NOT_ROOM_MEMBER');
  const next = clone(state);
  const events: GameEvent[] = [];
  next.version++;
  end(next, now, 'win', opponentOf(next, playerId).id, reason, events, { loserId: playerId });
  return { ok: true, state: next, events };
}

function applySetSecret(
  state: CtcState,
  playerId: string,
  code: string,
  now: number,
): ApplyResult<CtcState> {
  if (state.phase !== 'SETUP') return fail('GAME_ALREADY_STARTED', 'Codes are already locked in.');
  if (state.setupDeadlineAt !== null && now >= state.setupDeadlineAt) {
    return fail('INVALID_ACTION', 'Setup time is over.');
  }
  const me = playerOf(state, playerId)!;
  if (me.secret !== null) return fail('SECRET_ALREADY_SET');
  const check = checkCode(code, state.settings.codeLength);
  if (check !== 'ok') {
    return fail('INVALID_SECRET', secretMessage(check, state.settings.codeLength), { rule: check });
  }
  const next = clone(state);
  const events: GameEvent[] = [{ type: 'secret_locked', actorId: playerId, data: { auto: false } }];
  playerOf(next, playerId)!.secret = code;
  next.version++;
  if (next.players.every((p) => p.secret !== null)) beginPlaying(next, now, events);
  return { ok: true, state: next, events };
}

function applyGuess(
  state: CtcState,
  playerId: string,
  guess: string,
  now: number,
): ApplyResult<CtcState> {
  if (state.phase === 'SETUP')
    return fail('GAME_NOT_STARTED', 'Wait until both codes are locked in.');
  if (state.currentTurn !== playerId) return fail('NOT_YOUR_TURN');
  if (state.turnDeadlineAt !== null && now >= state.turnDeadlineAt) {
    return fail('NOT_YOUR_TURN', 'Your time ran out.', { reason: 'turn_expired' });
  }
  const check = checkCode(guess, state.settings.codeLength);
  if (check !== 'ok')
    return fail('INVALID_GUESS', secretMessage(check, state.settings.codeLength), { rule: check });
  if (state.moves.some((m) => m.playerId === playerId && m.guess === guess))
    return fail('DUPLICATE_GUESS');
  const me = playerOf(state, playerId)!;
  if (me.turnsUsed >= state.settings.maxGuesses) return fail('INVALID_ACTION', 'No guesses left.');

  const next = clone(state);
  const mover = playerOf(next, playerId)!;
  const target = opponentOf(next, playerId);
  const { bulls, cows } = score(target.secret!, guess);
  mover.turnsUsed++;
  if (bulls === next.settings.codeLength) mover.cracked = true;
  next.moves.push({
    playerId,
    guess,
    bulls,
    cows,
    timedOut: false,
    at: now,
    turnNumber: mover.turnsUsed,
  });
  const events: GameEvent[] = [
    { type: 'guess_made', actorId: playerId, data: { guess, bulls, cows, cracked: mover.cracked } },
  ];
  next.version++;
  afterTurn(next, playerId, now, events);
  return { ok: true, state: next, events };
}

function secretMessage(check: 'length' | 'digits' | 'repeat', length: number): string {
  if (check === 'length') return `Use exactly ${length} digits.`;
  if (check === 'digits') return 'Digits 0–9 only.';
  return 'Each digit can only appear once.';
}

function publicPlayers(state: CtcState): CtcPlayerPublic[] {
  return state.players.map((p) => ({
    userId: p.id,
    hasSecret: p.secret !== null,
    turnsUsed: p.turnsUsed,
    guessesLeft: state.settings.maxGuesses - p.turnsUsed,
    cracked: p.cracked,
  }));
}

function publicView(state: CtcState): CtcPublicView {
  return {
    gameId: CRACK_THE_CODE_ID,
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

export const crackTheCode: GameDefinition<CtcState, CtcSettings, CtcPlayerView, CtcPublicView> = {
  id: CRACK_THE_CODE_ID,
  name: 'Crack the Code',
  minPlayers: 2,
  maxPlayers: 2,
  // A secret is independent of the opponent's moves; giving up is always allowed.
  versionIndependentActions: ['SET_SECRET', 'FORFEIT'],

  parseSettings(input) {
    return ctcSettingsSchema.parse(input ?? {});
  },

  parseAction(input) {
    const parsed = ctcActionSchema.safeParse(input);
    return parsed.success ? parsed.data : null;
  },

  createInitialState(settings, ctx: CreateContext) {
    if (ctx.players.length !== 2) throw new Error('Crack the Code needs exactly 2 players');
    const firstPlayerId = ctx.players[ctx.firstPlayerIndex % 2]!;
    const mk = (id: string): CtcPlayerState => ({
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
      setupSeconds: CTC_LIMITS.setupSeconds,
      players: [mk(ctx.players[0]!), mk(ctx.players[1]!)],
      firstPlayerId,
      currentTurn: null,
      setupDeadlineAt: ctx.now + CTC_LIMITS.setupSeconds * 1000,
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
    const parsed = ctcActionSchema.safeParse(rawAction);
    if (!parsed.success) return fail('INVALID_ACTION', 'Unknown move.');
    const action = parsed.data;
    switch (action.type) {
      case 'SET_SECRET':
        return applySetSecret(state, actor.playerId, action.code, ctx.now);
      case 'GUESS':
        return applyGuess(state, actor.playerId, action.guess, ctx.now);
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
      // The opponent's code is revealed only once the game is officially over.
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

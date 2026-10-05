import type { AppErrorPayload, GameResult, RoomEventType } from '@rivalrush/shared';

/**
 * The game plug-in contract. A game is pure rules: no network, database, Telegram or
 * Socket.IO. RoomManager owns players, locking, versions, timers and persistence; the game
 * only turns (state, action, now) into a new state.
 */

/** Who performed an action: a seated player, or the server itself (timers, disconnects). */
export type Actor = { kind: 'player'; playerId: string } | { kind: 'system' };

/** Server-originated actions every game must understand. */
export type SystemAction =
  | { type: '$TIMEOUT' }
  | { type: '$ABANDON'; playerId: string }
  | { type: '$FORFEIT'; playerId: string };

export interface ApplyContext {
  now: number;
  /** Uniform random in [0, 1). Injected so tests are deterministic. */
  random: () => number;
}

export interface CreateContext extends ApplyContext {
  players: readonly string[];
  /** Index into `players` of who moves first. RoomManager randomizes, then swaps on rematch. */
  firstPlayerIndex: number;
}

/** A public, secret-free notification produced by the game (becomes a room:event). */
export interface GameEvent {
  type: RoomEventType;
  actorId: string | null;
  data?: Record<string, unknown>;
}

export type ApplyResult<S> =
  { ok: true; state: S; events: GameEvent[] } | { ok: false; error: AppErrorPayload };

export interface Deadline {
  at: number;
  action: SystemAction;
}

export interface GameDefinition<S, Settings, PlayerView, PublicView> {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  /** Validates and normalizes room settings; throws a ZodError on bad input. */
  parseSettings(input: unknown): Settings;
  /** Validates the client-supplied action payload shape; returns null when invalid. */
  parseAction(input: unknown): unknown | null;
  createInitialState(settings: Settings, ctx: CreateContext): S;
  /** Validates the action as part of applying it. Never mutates `state`. */
  applyAction(state: S, actor: Actor, action: unknown, ctx: ApplyContext): ApplyResult<S>;
  getPlayerView(state: S, playerId: string): PlayerView;
  getPublicView(state: S): PublicView;
  /** Null while the game is running. */
  getResult(state: S): GameResult | null;
  /** Monotonic game-state version, bumped by every accepted change. */
  getVersion(state: S): number;
  /** The next server-side deadline, if any (setup timer, turn timer). */
  getNextDeadline(state: S): Deadline | null;
  /** Secret-free move log for match history. */
  getMoves(state: S): unknown[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameDefinition = GameDefinition<any, any, any, any>;

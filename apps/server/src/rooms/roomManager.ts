import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  TERMINAL_ROOM_STATUSES,
  type GameMove,
  type GameId,
  type AnyGameResult,
  type InvitePreview,
  type RoomEvent,
  type RoomEventType,
  type RoomSnapshot,
} from '@rivalrush/shared';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { AppError } from '../errors.js';
import type { Actor, AnyGameDefinition, SystemAction } from '../games/engine/types.js';
import { getGame } from '../games/registry.js';
import type { FinishedSession } from '../matches/matchService.js';
import { tokenHint } from '../logger.js';
import type { SeatIdentity } from '../users/userService.js';
import { KeyedLock } from './keyedLock.js';
import type { RoomStore } from './RoomStore.js';
import { buildInvitePreview, buildSnapshot } from './roomViews.js';
import { TimerRegistry } from './timers.js';
import { nextStartingPlayer } from './rotation.js';
import type { LiveRoom, Seat } from './types.js';

export type RemovalReason = 'left' | 'expired' | 'closed';

/** Side-effect outlets. RoomManager itself knows nothing about sockets or databases. */
export interface RoomManagerHooks {
  /** Deliver per-player snapshots and events for this change. */
  roomChanged(room: LiveRoom, events: RoomEvent[]): void;
  /** A user no longer belongs to the room. */
  userRemoved(roomId: string, userId: string, reason: RemovalReason): void;
  /** A game session ended; record it. */
  gameFinished(session: FinishedSession): void;
  /** Membership/status changed; persist room metadata (best effort). */
  persistRoom(room: LiveRoom): void;
}

export interface RoomManagerOptions {
  roomTtlMs: number;
  disconnectGraceMs: number;
  /** How long CLOSED/EXPIRED tombstones stay in memory so old invites explain themselves. */
  terminalRetentionMs?: number;
  now?: () => number;
  random?: () => number;
  /** Game lookup. Defaults to the registry; tests inject games that aren't playable yet. */
  games?: (id: string) => AnyGameDefinition | null;
}

interface OpContext {
  now: number;
  events: RoomEvent[];
  removed: Array<{ userId: string; reason: RemovalReason }>;
  finished: FinishedSession[];
  persist: boolean;
  dirty: boolean;
}

const MAX_REMEMBERED_ACTIONS = 200;
// Uniform in [0, 1) from the CSPRNG (randomInt allows ranges up to 2^48 - 1).
const defaultRandom = () => randomInt(0, 2 ** 47) / 2 ** 47;

/**
 * Generic room lifecycle: create, join, ready, start, leave, rematch, presence, reconnect,
 * expiry and timers. Game rules live in the game plug-in; RoomManager never inspects them.
 *
 * Ordering guarantee: every mutation of a room runs inside that room's lock and first
 * applies every deadline that is already due ("timers win ties"). So for any two inputs
 * the server's processing order is the authoritative order.
 */
export class RoomManager {
  private readonly lock = new KeyedLock();
  private readonly timers: TimerRegistry;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly lookupGame: (id: string) => AnyGameDefinition | null;
  private readonly retentionMs: number;

  constructor(
    private readonly store: RoomStore,
    private readonly hooks: RoomManagerHooks,
    private readonly logger: Logger,
    private readonly opts: RoomManagerOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? defaultRandom;
    this.lookupGame = opts.games ?? getGame;
    this.retentionMs = opts.terminalRetentionMs ?? 30 * 60_000;
    this.timers = new TimerRegistry(this.now);
  }

  // ---------------------------------------------------------------- queries

  async getSnapshot(userId: string, roomId: string): Promise<RoomSnapshot> {
    const room = await this.requireRoom(roomId);
    this.requireMember(room, userId);
    return buildSnapshot(room, userId, this.now(), this.lookupGame);
  }

  async getActiveRoom(userId: string): Promise<RoomSnapshot | null> {
    const room = await this.store.findActiveByMember(userId);
    return room ? buildSnapshot(room, userId, this.now(), this.lookupGame) : null;
  }

  async getInvitePreview(userId: string, inviteToken: string): Promise<InvitePreview | null> {
    const room = await this.store.getByInviteToken(inviteToken);
    return room ? buildInvitePreview(room, userId) : null;
  }

  // ---------------------------------------------------------------- lobby

  async createRoom(
    user: SeatIdentity,
    gameType: string,
    rawSettings: unknown,
  ): Promise<RoomSnapshot> {
    const def = this.lookupGame(gameType);
    if (!def) throw new AppError('GAME_NOT_AVAILABLE');
    let settings;
    try {
      settings = def.parseSettings(rawSettings ?? {});
    } catch (err) {
      if (err instanceof ZodError) throw new AppError('VALIDATION_ERROR', 'Invalid game settings.');
      throw err;
    }
    return this.lock.run(`user:${user.userId}`, async () => {
      await this.leaveOtherRooms(user.userId, null);
      const now = this.now();
      const room: LiveRoom = {
        roomId: randomBytes(9).toString('base64url'),
        inviteToken: randomBytes(12).toString('base64url'),
        gameType: def.id as GameId,
        settings,
        hostId: user.userId,
        status: 'LOBBY',
        maxPlayers: def.maxPlayers,
        minPlayers: def.minPlayers,
        seats: [this.newSeat(user, now, true)],
        version: 1,
        createdAt: now,
        expiresAt: now + this.opts.roomTtlMs,
        game: null,
        gamesPlayed: 0,
        nextFirstPlayerId: null,
        processedActions: [],
        purgeAt: null,
      };
      await this.lock.run(`room:${room.roomId}`, async () => {
        await this.store.save(room);
        this.reschedule(room);
      });
      this.logger.info(
        {
          event: 'room.created',
          roomId: room.roomId,
          gameType: room.gameType,
          userId: user.userId,
          invite: tokenHint(room.inviteToken),
        },
        'room created',
      );
      this.hooks.persistRoom(room);
      return buildSnapshot(room, user.userId, now, this.lookupGame);
    });
  }

  async joinByInvite(user: SeatIdentity, inviteToken: string): Promise<RoomSnapshot> {
    return this.lock.run(`user:${user.userId}`, async () => {
      const target = await this.store.getByInviteToken(inviteToken);
      if (!target) throw new AppError('ROOM_NOT_FOUND', "This invite link doesn't work anymore.");
      if (!target.seats.some((s) => s.userId === user.userId)) {
        await this.leaveOtherRooms(user.userId, target.roomId);
      }
      return this.mutate(target.roomId, user.userId, (room, ctx) => {
        if (room.seats.some((s) => s.userId === user.userId)) return; // duplicate join: no-op
        if (room.status === 'EXPIRED') throw new AppError('ROOM_EXPIRED');
        if (room.status === 'CLOSED') throw new AppError('ROOM_CLOSED');
        if (room.status === 'IN_GAME') throw new AppError('GAME_ALREADY_STARTED');
        if (room.seats.length >= room.maxPlayers) throw new AppError('ROOM_FULL');
        room.seats.push(this.newSeat(user, ctx.now, false));
        this.recomputeLobby(room);
        this.touch(room, ctx);
        this.bump(room, ctx, 'player_joined', user.userId, { displayName: user.displayName });
        ctx.persist = true;
        this.logger.info(
          { event: 'room.joined', roomId: room.roomId, userId: user.userId },
          'room joined',
        );
      });
    });
  }

  async setReady(
    userId: string,
    roomId: string,
    ready: boolean,
    actionId: string,
  ): Promise<RoomSnapshot> {
    return this.mutate(roomId, userId, (room, ctx) => {
      const seat = this.requireMember(room, userId);
      if (this.isDuplicate(room, userId, actionId)) return;
      if (room.status !== 'LOBBY' && room.status !== 'READY') {
        throw new AppError('GAME_ALREADY_STARTED');
      }
      // The host is always ready; their "ready" is pressing Start.
      const next = userId === room.hostId ? true : ready;
      if (seat.ready === next) return;
      seat.ready = next;
      this.recomputeLobby(room);
      this.remember(room, userId, actionId);
      this.bump(room, ctx, 'player_ready', userId, { ready: next });
    });
  }

  async start(userId: string, roomId: string, actionId: string): Promise<RoomSnapshot> {
    return this.mutate(roomId, userId, (room, ctx) => {
      this.requireMember(room, userId);
      if (this.isDuplicate(room, userId, actionId)) return;
      if (room.hostId !== userId) throw new AppError('NOT_HOST');
      if (room.status === 'IN_GAME') throw new AppError('GAME_ALREADY_STARTED');
      if (room.status !== 'READY') throw new AppError('NOT_READY');
      this.remember(room, userId, actionId);
      this.startGame(room, ctx, false);
    });
  }

  async rematch(userId: string, roomId: string, actionId: string): Promise<RoomSnapshot> {
    return this.mutate(roomId, userId, (room, ctx) => {
      const seat = this.requireMember(room, userId);
      if (this.isDuplicate(room, userId, actionId)) return;
      if (room.status !== 'FINISHED' || room.seats.length < room.minPlayers) {
        throw new AppError('REMATCH_UNAVAILABLE');
      }
      this.remember(room, userId, actionId);
      if (!seat.wantsRematch) {
        seat.wantsRematch = true;
        this.bump(room, ctx, 'rematch_requested', userId);
      }
      if (room.seats.every((s) => s.wantsRematch)) {
        this.startGame(room, ctx, true);
        this.bump(room, ctx, 'rematch_started', null);
      }
    });
  }

  /** Leaving is idempotent. Leaving a live game is an immediate forfeit. */
  async leave(userId: string, roomId: string): Promise<void> {
    const room = await this.store.get(roomId);
    if (!room || !room.seats.some((s) => s.userId === userId)) return;
    await this.mutate(
      roomId,
      userId,
      (r, ctx) => {
        if (!r.seats.some((s) => s.userId === userId)) return;
        if (r.status === 'IN_GAME' && r.game && !r.game.result) {
          this.applyGame(r, ctx, { kind: 'system' }, { type: '$FORFEIT', playerId: userId });
        }
        this.removeSeat(r, ctx, userId, 'left');
      },
      { allowNonMember: true },
    );
  }

  // ---------------------------------------------------------------- game

  async gameAction(
    userId: string,
    input: { roomId: string; actionId: string; clientVersion: number; action: unknown },
  ): Promise<RoomSnapshot> {
    return this.mutate(input.roomId, userId, (room, ctx) => {
      this.requireMember(room, userId);
      if (this.isDuplicate(room, userId, input.actionId)) return;
      if (!room.game) throw new AppError('GAME_NOT_STARTED');
      if (room.status !== 'IN_GAME' || room.game.result) throw new AppError('GAME_FINISHED');
      const def = this.def(room.game.gameType);
      const action = def.parseAction(input.action) as { type: string } | null;
      if (!action) throw new AppError('INVALID_ACTION', 'Unknown move.');
      const current = def.getVersion(room.game.state);
      if (input.clientVersion !== current && !def.versionIndependentActions.includes(action.type)) {
        throw new AppError('STALE_GAME_VERSION', undefined, { currentVersion: current });
      }
      const r = this.applyGame(room, ctx, { kind: 'player', playerId: userId }, action);
      if (!r.ok) throw AppError.from(r.error);
      this.remember(room, userId, input.actionId);
    });
  }

  // ---------------------------------------------------------------- presence

  /** A realtime connection subscribed to the room (also used for reconnects). */
  async connect(userId: string, roomId: string): Promise<RoomSnapshot> {
    return this.mutate(roomId, userId, (room, ctx) => {
      const seat = this.requireMember(room, userId);
      seat.connections++;
      seat.lastSeenAt = ctx.now;
      if (seat.connections === 1) {
        const wasAway = seat.graceDeadlineAt !== null;
        seat.graceDeadlineAt = null;
        this.bump(room, ctx, 'player_online', userId, { reconnected: wasAway });
        if (wasAway)
          this.logger.info({ event: 'player.reconnected', roomId, userId }, 'player reconnected');
      } else {
        ctx.dirty = true;
      }
    });
  }

  async disconnect(userId: string, roomId: string): Promise<void> {
    const room = await this.store.get(roomId);
    if (!room || !room.seats.some((s) => s.userId === userId)) return;
    await this.mutate(
      roomId,
      userId,
      (r, ctx) => {
        const seat = r.seats.find((s) => s.userId === userId);
        if (!seat) return;
        seat.connections = Math.max(0, seat.connections - 1);
        seat.lastSeenAt = ctx.now;
        ctx.dirty = true;
        if (seat.connections > 0) return;
        if (r.status === 'IN_GAME' && r.game && !r.game.result) {
          seat.graceDeadlineAt = ctx.now + this.opts.disconnectGraceMs;
        }
        this.bump(r, ctx, 'player_offline', userId, { graceDeadlineAt: seat.graceDeadlineAt });
      },
      { allowNonMember: true },
    );
  }

  /** Stop all timers (shutdown/tests). */
  shutdown(): void {
    this.timers.clearAll();
  }

  // ---------------------------------------------------------------- core

  /**
   * Runs `fn` on the room under its lock: load → apply due deadlines → fn → save → publish.
   * Returns the caller's fresh snapshot. Errors thrown by `fn` still persist any
   * deadline-driven changes that happened first.
   */
  private async mutate(
    roomId: string,
    userId: string,
    fn: (room: LiveRoom, ctx: OpContext) => void,
    opts: { allowNonMember?: boolean } = {},
  ): Promise<RoomSnapshot> {
    return this.lock.run(`room:${roomId}`, async () => {
      const room = await this.requireRoom(roomId);
      const ctx: OpContext = {
        now: this.now(),
        events: [],
        removed: [],
        finished: [],
        persist: false,
        dirty: false,
      };
      const startVersion = room.version;
      this.advanceDue(room, ctx);
      let error: unknown = null;
      if (TERMINAL_ROOM_STATUSES.includes(room.status) && !opts.allowNonMember) {
        error = new AppError(room.status === 'EXPIRED' ? 'ROOM_EXPIRED' : 'ROOM_CLOSED');
      } else {
        try {
          fn(room, ctx);
        } catch (err) {
          error = err;
        }
      }
      await this.commit(room, ctx, startVersion);
      if (error) throw error;
      return buildSnapshot(room, userId, ctx.now, this.lookupGame);
    });
  }

  private async commit(room: LiveRoom, ctx: OpContext, startVersion: number): Promise<void> {
    const changed = room.version !== startVersion;
    if (!changed && !ctx.dirty) return;
    if (TERMINAL_ROOM_STATUSES.includes(room.status) && room.purgeAt === null) {
      room.purgeAt = ctx.now + this.retentionMs;
      for (const s of room.seats)
        ctx.removed.push({
          userId: s.userId,
          reason: room.status === 'EXPIRED' ? 'expired' : 'closed',
        });
    }
    await this.store.save(room);
    this.reschedule(room);
    // Side effects after the state is saved; hooks must not throw into the lock.
    const safe = (what: string, f: () => void) => {
      try {
        f();
      } catch (err) {
        this.logger.error({ err, roomId: room.roomId, hook: what }, 'room hook failed');
      }
    };
    if (changed) safe('roomChanged', () => this.hooks.roomChanged(room, ctx.events));
    for (const r of ctx.removed)
      safe('userRemoved', () => this.hooks.userRemoved(room.roomId, r.userId, r.reason));
    for (const f of ctx.finished) safe('gameFinished', () => this.hooks.gameFinished(f));
    if (ctx.persist) safe('persistRoom', () => this.hooks.persistRoom(room));
  }

  /** Applies every due deadline in time order. Game deadlines win ties with grace expiry. */
  private advanceDue(room: LiveRoom, ctx: OpContext): void {
    for (let guard = 0; guard < 10_000; guard++) {
      const due = this.nextDue(room);
      if (!due || due.at > ctx.now) break;
      if (due.kind === 'game') {
        const r = this.applyGame(room, ctx, { kind: 'system' }, due.action);
        if (!r.ok) {
          this.logger.error(
            { roomId: room.roomId, code: r.error.code },
            'due game deadline rejected',
          );
          break;
        }
      } else {
        const seat = room.seats.find((s) => s.userId === due.userId)!;
        seat.graceDeadlineAt = null;
        this.logger.info(
          { event: 'game.abandoned', roomId: room.roomId, userId: due.userId },
          'grace period expired',
        );
        this.applyGame(room, ctx, { kind: 'system' }, { type: '$ABANDON', playerId: due.userId });
      }
    }
    if (!TERMINAL_ROOM_STATUSES.includes(room.status) && ctx.now >= room.expiresAt) {
      if (room.status === 'IN_GAME') {
        room.expiresAt = ctx.now + this.opts.roomTtlMs; // a live game keeps its room alive
        ctx.dirty = true;
      } else {
        room.status = 'EXPIRED';
        ctx.persist = true;
        this.bump(room, ctx, 'player_left', null, { expired: true });
        this.logger.info({ event: 'room.expired', roomId: room.roomId }, 'room expired');
      }
    }
  }

  private nextDue(
    room: LiveRoom,
  ):
    | { kind: 'game'; at: number; action: SystemAction }
    | { kind: 'grace'; at: number; userId: string }
    | null {
    if (room.status !== 'IN_GAME' || !room.game || room.game.result) return null;
    const deadline = this.def(room.game.gameType).getNextDeadline(room.game.state);
    let best:
      | { kind: 'game'; at: number; action: SystemAction }
      | { kind: 'grace'; at: number; userId: string }
      | null = deadline ? { kind: 'game', at: deadline.at, action: deadline.action } : null;
    for (const s of room.seats) {
      if (s.graceDeadlineAt !== null && (!best || s.graceDeadlineAt < best.at)) {
        best = { kind: 'grace', at: s.graceDeadlineAt, userId: s.userId };
      }
    }
    return best;
  }

  private applyGame(room: LiveRoom, ctx: OpContext, actor: Actor, action: unknown) {
    const game = room.game!;
    const def = this.def(game.gameType);
    const r = def.applyAction(game.state, actor, action, { now: ctx.now, random: this.random });
    if (!r.ok) return r;
    game.state = r.state;
    room.version++;
    for (const e of r.events) {
      ctx.events.push({
        type: e.type,
        roomId: room.roomId,
        version: room.version,
        at: ctx.now,
        actorId: e.actorId,
        ...(e.data ? { data: e.data } : {}),
      });
    }
    const result = def.getResult(r.state);
    if (result) this.finishGame(room, ctx, def, result);
    return r;
  }

  private startGame(room: LiveRoom, ctx: OpContext, isRematch: boolean): void {
    const def = this.def(room.gameType);
    const players = room.seats.map((s) => s.userId);
    let firstIdx = room.nextFirstPlayerId ? players.indexOf(room.nextFirstPlayerId) : -1;
    if (firstIdx < 0) firstIdx = Math.floor(this.random() * players.length);
    const state = def.createInitialState(room.settings, {
      players,
      firstPlayerIndex: firstIdx,
      now: ctx.now,
      random: this.random,
    });
    room.game = {
      sessionId: randomUUID(),
      gameType: room.gameType,
      players,
      roster: room.seats.map((s) => ({
        userId: s.userId,
        displayName: s.displayName,
        photoUrl: s.photoUrl,
      })),
      isRematch,
      firstPlayerId: players[firstIdx]!,
      state,
      startedAt: ctx.now,
      endedAt: null,
      result: null,
    };
    room.status = 'IN_GAME';
    for (const s of room.seats) {
      s.wantsRematch = false;
      // Someone who is not connected when the game starts gets the same grace period.
      s.graceDeadlineAt = s.connections > 0 ? null : ctx.now + this.opts.disconnectGraceMs;
    }
    this.touch(room, ctx);
    ctx.persist = true;
    this.bump(room, ctx, 'game_started', null, {
      sessionId: room.game.sessionId,
      isRematch,
      firstPlayerId: room.game.firstPlayerId,
    });
    this.logger.info(
      { event: 'game.started', roomId: room.roomId, sessionId: room.game.sessionId, isRematch },
      'game started',
    );
  }

  private finishGame(
    room: LiveRoom,
    ctx: OpContext,
    def: AnyGameDefinition,
    result: AnyGameResult,
  ): void {
    const game = room.game!;
    game.result = result;
    game.endedAt = ctx.now;
    room.status = 'FINISHED';
    room.gamesPlayed++;
    room.nextFirstPlayerId = nextStartingPlayer(game.players, game.firstPlayerId, (id) =>
      room.seats.some((s) => s.userId === id),
    );
    for (const s of room.seats) {
      s.wantsRematch = false;
      s.graceDeadlineAt = null;
    }
    this.touch(room, ctx);
    ctx.persist = true;
    // Names come from the start-of-game snapshot, so a player who left mid-game keeps theirs.
    const coop = def.getCoopPlayerRecords?.(game.state);
    const generator = def.getGeneratorInfo?.(game.state) ?? null;
    ctx.finished.push({
      sessionId: game.sessionId,
      roomId: room.roomId,
      gameType: game.gameType,
      settings: { ...room.settings },
      isRematch: game.isRematch,
      players: game.roster.map((p) => ({
        userId: p.userId,
        displayName: p.displayName,
        photoUrl: p.photoUrl,
        ...(coop?.[p.userId] ? { coop: coop[p.userId] } : {}),
      })),
      result,
      moves: def.getMoves(game.state) as GameMove[],
      ...(generator ? { generator } : {}),
      startedAt: game.startedAt,
      endedAt: ctx.now,
    });
    this.logger.info(
      {
        event: 'game.ended',
        roomId: room.roomId,
        sessionId: game.sessionId,
        reason: result.reason,
        outcome: result.outcome,
      },
      'game ended',
    );
  }

  private removeSeat(room: LiveRoom, ctx: OpContext, userId: string, reason: RemovalReason): void {
    room.seats = room.seats.filter((s) => s.userId !== userId);
    ctx.removed.push({ userId, reason });
    ctx.persist = true;
    this.bump(room, ctx, 'player_left', userId);
    this.logger.info({ event: 'room.left', roomId: room.roomId, userId }, 'player left room');
    if (room.seats.length === 0) {
      room.status = 'CLOSED';
      this.logger.info({ event: 'room.closed', roomId: room.roomId }, 'room closed');
      return;
    }
    if (room.hostId === userId) {
      room.hostId = room.seats[0]!.userId;
      room.seats[0]!.ready = true;
      this.bump(room, ctx, 'host_changed', room.hostId);
    }
    for (const s of room.seats) s.wantsRematch = false;
    // Whoever is left waits in the lobby; the same invite link can bring a new opponent.
    // The finished game is already recorded; drop it so a newcomer never sees its moves.
    if (room.status === 'FINISHED') {
      room.status = 'LOBBY';
      room.game = null;
      room.nextFirstPlayerId = null;
    }
    this.recomputeLobby(room);
  }

  /** Leaves any other active room the user is in; refuses if that room has a live game. */
  private async leaveOtherRooms(userId: string, exceptRoomId: string | null): Promise<void> {
    const other = await this.store.findActiveByMember(userId);
    if (!other || other.roomId === exceptRoomId) return;
    if (other.status === 'IN_GAME' && other.game && !other.game.result) {
      throw new AppError('ALREADY_IN_ROOM', 'Finish or leave your current game first.', {
        roomId: other.roomId,
      });
    }
    await this.leave(userId, other.roomId);
  }

  private recomputeLobby(room: LiveRoom): void {
    if (room.status !== 'LOBBY' && room.status !== 'READY') return;
    const full = room.seats.length >= room.minPlayers;
    room.status = full && room.seats.every((s) => s.ready) ? 'READY' : 'LOBBY';
  }

  private reschedule(room: LiveRoom): void {
    const prefix = `${room.roomId}:`;
    this.timers.clearPrefix(prefix);
    const wake = () => void this.tick(room.roomId);
    if (room.purgeAt !== null) {
      this.timers.set(`${prefix}purge`, room.purgeAt, () => void this.purge(room.roomId));
      return;
    }
    this.timers.set(`${prefix}expiry`, room.expiresAt, wake);
    const due = this.nextDue(room);
    // A deadline already in the past here means it was rejected (a bug); back off instead of spinning.
    if (due)
      this.timers.set(`${prefix}due`, due.at > this.now() ? due.at : this.now() + 1000, wake);
  }

  /** Timer wake-up: re-checks deadlines under the lock (no-op if nothing is due). */
  private async tick(roomId: string): Promise<void> {
    try {
      await this.lock.run(`room:${roomId}`, async () => {
        const room = await this.store.get(roomId);
        if (!room) return;
        const ctx: OpContext = {
          now: this.now(),
          events: [],
          removed: [],
          finished: [],
          persist: false,
          dirty: false,
        };
        const startVersion = room.version;
        this.advanceDue(room, ctx);
        await this.commit(room, ctx, startVersion);
        if (room.version === startVersion && !ctx.dirty) this.reschedule(room);
      });
    } catch (err) {
      this.logger.error({ err, roomId }, 'room timer failed');
    }
  }

  private async purge(roomId: string): Promise<void> {
    await this.lock.run(`room:${roomId}`, async () => {
      const room = await this.store.get(roomId);
      if (room && TERMINAL_ROOM_STATUSES.includes(room.status)) await this.store.delete(roomId);
    });
  }

  // ---------------------------------------------------------------- helpers

  private bump(
    room: LiveRoom,
    ctx: OpContext,
    type: RoomEventType,
    actorId: string | null,
    data?: Record<string, unknown>,
  ) {
    room.version++;
    ctx.events.push({
      type,
      roomId: room.roomId,
      version: room.version,
      at: ctx.now,
      actorId,
      ...(data ? { data } : {}),
    });
  }

  private touch(room: LiveRoom, ctx: OpContext): void {
    room.expiresAt = ctx.now + this.opts.roomTtlMs;
  }

  private newSeat(user: SeatIdentity, now: number, isHost: boolean): Seat {
    return {
      userId: user.userId,
      displayName: user.displayName,
      photoUrl: user.photoUrl,
      ready: isHost,
      connections: 0,
      wantsRematch: false,
      joinedAt: now,
      lastSeenAt: now,
      graceDeadlineAt: null,
    };
  }

  private isDuplicate(room: LiveRoom, userId: string, actionId: string): boolean {
    return room.processedActions.includes(`${userId}:${actionId}`);
  }

  private remember(room: LiveRoom, userId: string, actionId: string): void {
    room.processedActions.push(`${userId}:${actionId}`);
    if (room.processedActions.length > MAX_REMEMBERED_ACTIONS) {
      room.processedActions.splice(0, room.processedActions.length - MAX_REMEMBERED_ACTIONS);
    }
  }

  private def(gameType: string): AnyGameDefinition {
    const def = this.lookupGame(gameType);
    if (!def) throw new AppError('GAME_NOT_AVAILABLE');
    return def;
  }

  private async requireRoom(roomId: string): Promise<LiveRoom> {
    const room = await this.store.get(roomId);
    if (!room) throw new AppError('ROOM_NOT_FOUND');
    return room;
  }

  private requireMember(room: LiveRoom, userId: string): Seat {
    const seat = room.seats.find((s) => s.userId === userId);
    if (!seat) throw new AppError('NOT_ROOM_MEMBER');
    return seat;
  }
}

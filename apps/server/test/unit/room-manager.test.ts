import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aid, alice, bob, carol, GRACE_MS, makeManager, TTL_MS } from '../helpers/manager.js';
import { code, guess, lobby, playing } from '../helpers/scenarios.js';
import { duelView } from '../helpers/views.js';

const T0 = new Date('2026-10-05T12:00:00Z').getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('create / join', () => {
  it('creates a LOBBY room with the host ready and an unguessable invite token', async () => {
    const { manager } = makeManager();
    const snap = await manager.createRoom(alice, 'crack-the-code', { codeLength: 5 });
    expect(snap.status).toBe('LOBBY');
    expect(snap.hostId).toBe(alice.userId);
    expect(snap.players).toEqual([
      expect.objectContaining({ userId: alice.userId, isHost: true, ready: true }),
    ]);
    expect(snap.inviteToken).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(snap.settings).toEqual({ codeLength: 5, turnSeconds: 45, maxGuesses: 10 });
  });

  it('rejects unknown games and invalid settings', async () => {
    const { manager } = makeManager();
    expect(await code(manager.createRoom(alice, 'defuser', {}))).toBe('GAME_NOT_AVAILABLE');
    expect(await code(manager.createRoom(alice, 'crack-the-code', { turnSeconds: 5 }))).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('join → LOBBY until the guest is ready → READY', async () => {
    const { manager } = makeManager();
    const room = await manager.createRoom(alice, 'crack-the-code', {});
    const joined = await manager.joinByInvite(bob, room.inviteToken);
    expect(joined.status).toBe('LOBBY');
    const ready = await manager.setReady(bob.userId, room.roomId, true, aid());
    expect(ready.status).toBe('READY');
    const unready = await manager.setReady(bob.userId, room.roomId, false, aid());
    expect(unready.status).toBe('LOBBY');
  });

  it('duplicate join is a no-op', async () => {
    const { manager, roomId, inviteToken, raw } = await lobby();
    const before = (await raw(roomId)).version;
    const again = await manager.joinByInvite(bob, inviteToken);
    expect(again.players).toHaveLength(2);
    expect((await raw(roomId)).version).toBe(before);
  });

  it('rejects a third player (room full) and bad invites', async () => {
    const { manager, inviteToken } = await lobby();
    expect(await code(manager.joinByInvite(carol, inviteToken))).toBe('ROOM_FULL');
    expect(await code(manager.joinByInvite(carol, 'NoSuchTokenAtAll1234'))).toBe('ROOM_NOT_FOUND');
  });

  it('expired rooms cannot be joined and old invites explain why', async () => {
    const { manager } = makeManager();
    const room = await manager.createRoom(alice, 'crack-the-code', {});
    await vi.advanceTimersByTimeAsync(TTL_MS + 1000);
    expect(await code(manager.joinByInvite(bob, room.inviteToken))).toBe('ROOM_EXPIRED');
    expect((await manager.getInvitePreview(bob.userId, room.inviteToken))?.reason).toBe(
      'ROOM_EXPIRED',
    );
  });

  it('closed rooms cannot be joined', async () => {
    const { manager } = makeManager();
    const room = await manager.createRoom(alice, 'crack-the-code', {});
    await manager.leave(alice.userId, room.roomId);
    expect(await code(manager.joinByInvite(bob, room.inviteToken))).toBe('ROOM_CLOSED');
  });

  it('a user holds one active room: creating another leaves the old lobby', async () => {
    const { manager } = makeManager();
    const first = await manager.createRoom(alice, 'crack-the-code', {});
    const second = await manager.createRoom(alice, 'crack-the-code', {});
    expect((await manager.getActiveRoom(alice.userId))?.roomId).toBe(second.roomId);
    expect(await code(manager.getSnapshot(alice.userId, first.roomId))).toBe('NOT_ROOM_MEMBER');
  });

  it('cannot start another room while a game is live (ALREADY_IN_ROOM)', async () => {
    const { manager } = await playing();
    expect(await code(manager.createRoom(alice, 'crack-the-code', {}))).toBe('ALREADY_IN_ROOM');
  });

  it('non-members cannot read or act on a room', async () => {
    const { manager, roomId } = await lobby();
    expect(await code(manager.getSnapshot(carol.userId, roomId))).toBe('NOT_ROOM_MEMBER');
    expect(await code(manager.setReady(carol.userId, roomId, true, aid()))).toBe('NOT_ROOM_MEMBER');
    expect(await code(manager.connect(carol.userId, roomId))).toBe('NOT_ROOM_MEMBER');
    expect(
      await code(
        manager.gameAction(carol.userId, {
          roomId,
          actionId: aid(),
          clientVersion: 1,
          action: { type: 'FORFEIT' },
        }),
      ),
    ).toBe('NOT_ROOM_MEMBER');
  });
});

describe('host + start', () => {
  it('only the host can start, and only when READY', async () => {
    const { manager } = makeManager();
    const room = await manager.createRoom(alice, 'crack-the-code', {});
    expect(await code(manager.start(alice.userId, room.roomId, aid()))).toBe('NOT_READY');
    await manager.joinByInvite(bob, room.inviteToken);
    expect(await code(manager.start(bob.userId, room.roomId, aid()))).toBe('NOT_HOST');
    expect(await code(manager.start(alice.userId, room.roomId, aid()))).toBe('NOT_READY');
    await manager.setReady(bob.userId, room.roomId, true, aid());
    const started = await manager.start(alice.userId, room.roomId, aid());
    expect(started.status).toBe('IN_GAME');
    expect(duelView(started.game?.view).phase).toBe('SETUP');
  });

  it('duplicate start (same actionId) applies once; a second start is rejected', async () => {
    const { manager, roomId, raw } = await lobby();
    const id = aid();
    await manager.start(alice.userId, roomId, id);
    const v = (await raw(roomId)).version;
    const session = (await raw(roomId)).game!.sessionId;
    await manager.start(alice.userId, roomId, id);
    expect((await raw(roomId)).version).toBe(v);
    expect((await raw(roomId)).game!.sessionId).toBe(session);
    expect(await code(manager.start(alice.userId, roomId, aid()))).toBe('GAME_ALREADY_STARTED');
  });

  it('host leaving the lobby hands the room to the remaining player', async () => {
    const { manager, roomId, removed } = await lobby();
    await manager.leave(alice.userId, roomId);
    const snap = await manager.getSnapshot(bob.userId, roomId);
    expect(snap.hostId).toBe(bob.userId);
    expect(snap.players).toEqual([
      expect.objectContaining({ userId: bob.userId, isHost: true, ready: true }),
    ]);
    expect(snap.status).toBe('LOBBY');
    expect(removed).toContainEqual({ roomId, userId: alice.userId, reason: 'left' });
  });
});

describe('gameplay through the manager', () => {
  it('plays to a win and records the session exactly once', async () => {
    const ctx = await playing();
    const target = ctx.first === alice ? '5678' : '1234';
    await guess(ctx, ctx.first, '9012');
    await guess(ctx, ctx.second, '9012');
    const snap = await guess(ctx, ctx.first, target);
    expect(duelView(snap.game?.view).phase).toBe('LAST_CHANCE');
    const end = await guess(ctx, ctx.second, '9013');
    expect(end.status).toBe('FINISHED');
    expect(end.game?.result).toEqual({
      outcome: 'win',
      winnerId: ctx.first.userId,
      reason: 'cracked',
    });
    expect(ctx.finished).toHaveLength(1);
    expect(ctx.finished[0]!.moves).toHaveLength(4);
    // The recorded session carries guesses and scores only, never secret fields.
    expect(JSON.stringify(ctx.finished[0])).not.toMatch(/secret/i);
    const unrevealed = ctx.first === alice ? '1234' : '5678'; // the first player's code was never guessed
    expect(JSON.stringify(ctx.finished[0])).not.toContain(unrevealed);
  });

  it('snapshots never contain the opponent secret while the game is live', async () => {
    const ctx = await playing();
    await guess(ctx, ctx.first, '9012');
    for (const change of ctx.changes) {
      const live = change.room.game && !change.room.game.result;
      if (!live) continue;
      for (const viewer of [alice, bob]) {
        const snap = await ctx.manager.getSnapshot(viewer.userId, ctx.roomId);
        const opp = viewer === alice ? '5678' : '1234';
        expect(duelView(snap.game?.view).opponentSecret).toBeNull();
        expect(
          JSON.stringify({
            ...snap,
            game: { ...snap.game, view: { ...duelView(snap.game!.view), moves: [] } },
          }),
        ).not.toContain(opp);
      }
    }
  });

  it('rejects out-of-turn guesses', async () => {
    const ctx = await playing();
    expect(await code(guess(ctx, ctx.second, '9012'))).toBe('NOT_YOUR_TURN');
  });

  it('duplicate SET_SECRET is safe', async () => {
    const ctx = await lobby();
    await ctx.manager.start(alice.userId, ctx.roomId, aid());
    const id = aid();
    const p = {
      roomId: ctx.roomId,
      actionId: id,
      clientVersion: 1,
      action: { type: 'SET_SECRET', code: '1234' },
    };
    await ctx.manager.gameAction(alice.userId, p);
    await ctx.manager.gameAction(alice.userId, p);
    expect(
      await code(
        ctx.manager.gameAction(alice.userId, {
          ...p,
          actionId: aid(),
          action: { type: 'SET_SECRET', code: '4321' },
        }),
      ),
    ).toBe('SECRET_ALREADY_SET');
  });

  it('stale clientVersion is rejected for guesses but not for secrets', async () => {
    const ctx = await lobby();
    await ctx.manager.start(alice.userId, ctx.roomId, aid());
    await ctx.manager.gameAction(alice.userId, {
      roomId: ctx.roomId,
      actionId: aid(),
      clientVersion: 1,
      action: { type: 'SET_SECRET', code: '1234' },
    });
    // Bob's client still believes version 1: secrets are version-independent.
    await ctx.manager.gameAction(bob.userId, {
      roomId: ctx.roomId,
      actionId: aid(),
      clientVersion: 1,
      action: { type: 'SET_SECRET', code: '5678' },
    });
    const s = await ctx.state(ctx.roomId);
    expect(s.phase).toBe('PLAYING');
    const r = await code(
      ctx.manager.gameAction(s.currentTurn!, {
        roomId: ctx.roomId,
        actionId: aid(),
        clientVersion: s.version - 1,
        action: { type: 'GUESS', guess: '9012' },
      }),
    );
    expect(r).toBe('STALE_GAME_VERSION');
  });

  it('client-supplied identity or results are ignored (no fake winner)', async () => {
    const ctx = await playing();
    const v = (await ctx.state(ctx.roomId)).version;
    expect(
      await code(
        ctx.manager.gameAction(ctx.first.userId, {
          roomId: ctx.roomId,
          actionId: aid(),
          clientVersion: v,
          action: { type: 'GUESS', guess: '9012', playerId: ctx.second.userId },
        }),
      ),
    ).toBe('INVALID_ACTION');
    expect(
      await code(
        ctx.manager.gameAction(ctx.first.userId, {
          roomId: ctx.roomId,
          actionId: aid(),
          clientVersion: v,
          action: { type: '$FORFEIT', playerId: ctx.second.userId },
        }),
      ),
    ).toBe('INVALID_ACTION');
    expect(
      await code(
        ctx.manager.gameAction(ctx.first.userId, {
          roomId: ctx.roomId,
          actionId: aid(),
          clientVersion: v,
          action: { type: 'WIN' },
        }),
      ),
    ).toBe('INVALID_ACTION');
  });
});

describe('timers and races', () => {
  it('server turn timer burns the turn when it expires', async () => {
    const ctx = await playing();
    const s = await ctx.state(ctx.roomId);
    await vi.advanceTimersByTimeAsync(s.turnDeadlineAt! - Date.now());
    const after = await ctx.state(ctx.roomId);
    expect(after.currentTurn).toBe(ctx.second.userId);
    expect(after.moves.at(-1)).toMatchObject({ playerId: ctx.first.userId, timedOut: true });
    expect(ctx.changes.at(-1)!.events.map((e) => e.type)).toContain('turn_timed_out');
  });

  it('setup timer auto-generates missing secrets', async () => {
    const ctx = await lobby();
    await ctx.manager.connect(alice.userId, ctx.roomId);
    await ctx.manager.connect(bob.userId, ctx.roomId);
    await ctx.manager.start(alice.userId, ctx.roomId, aid());
    await vi.advanceTimersByTimeAsync(60_000);
    const s = await ctx.state(ctx.roomId);
    expect(s.phase).toBe('PLAYING');
    expect(s.players.every((p) => p.secret && p.autoSecret)).toBe(true);
  });

  it('guess one millisecond before the deadline is accepted', async () => {
    const ctx = await playing();
    const s = await ctx.state(ctx.roomId);
    vi.setSystemTime(s.turnDeadlineAt! - 1);
    await guess(ctx, ctx.first, '9012');
    expect((await ctx.state(ctx.roomId)).moves[0]).toMatchObject({
      guess: '9012',
      timedOut: false,
    });
  });

  it('rematch is unavailable before a game ends or once the opponent left', async () => {
    const ctx = await playing();
    expect(await code(ctx.manager.rematch(alice.userId, ctx.roomId, aid()))).toBe(
      'REMATCH_UNAVAILABLE',
    );
    await ctx.manager.leave(bob.userId, ctx.roomId);
    expect(await code(ctx.manager.rematch(alice.userId, ctx.roomId, aid()))).toBe(
      'REMATCH_UNAVAILABLE',
    );
  });
});

describe('presence, disconnects and reconnects', () => {
  it('disconnect beyond the grace period = abandoned loss', async () => {
    const ctx = await playing();
    await ctx.manager.disconnect(alice.userId, ctx.roomId);
    const snap = await ctx.manager.getSnapshot(bob.userId, ctx.roomId);
    expect(snap.players.find((p) => p.userId === alice.userId)).toMatchObject({
      online: false,
      graceDeadlineAt: Date.now() + GRACE_MS,
    });
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    const end = await ctx.manager.getSnapshot(bob.userId, ctx.roomId);
    expect(end.game?.result).toEqual({ outcome: 'win', winnerId: bob.userId, reason: 'abandoned' });
    expect(duelView(end.game?.view).phase).toBe('ABANDONED');
    expect(ctx.finished).toHaveLength(1);
  });

  it('reconnecting within the grace period restores the player', async () => {
    const ctx = await playing();
    await ctx.manager.disconnect(alice.userId, ctx.roomId);
    await vi.advanceTimersByTimeAsync(GRACE_MS / 2);
    const snap = await ctx.manager.connect(alice.userId, ctx.roomId);
    expect(snap.players.find((p) => p.userId === alice.userId)).toMatchObject({
      online: true,
      graceDeadlineAt: null,
    });
    expect(snap.game?.result).toBeNull();
    expect(duelView(snap.game?.view).mySecret).toBe('1234');
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    const later = await ctx.manager.getSnapshot(alice.userId, ctx.roomId);
    expect(later.game?.result?.reason).not.toBe('abandoned');
  });

  it('reconnect exactly at the grace deadline: the expiry wins', async () => {
    const ctx = await playing();
    await ctx.manager.disconnect(alice.userId, ctx.roomId);
    const deadline = Date.now() + GRACE_MS;
    vi.setSystemTime(deadline);
    const snap = await ctx.manager.connect(alice.userId, ctx.roomId);
    expect(snap.game?.result).toMatchObject({ winnerId: bob.userId, reason: 'abandoned' });
  });

  it('a second tab keeps the player online when one connection drops', async () => {
    const ctx = await playing();
    await ctx.manager.connect(alice.userId, ctx.roomId);
    await ctx.manager.disconnect(alice.userId, ctx.roomId);
    const snap = await ctx.manager.getSnapshot(bob.userId, ctx.roomId);
    expect(snap.players.find((p) => p.userId === alice.userId)).toMatchObject({
      online: true,
      graceDeadlineAt: null,
    });
  });

  it('a player who never connects when the game starts gets the same grace period', async () => {
    const ctx = await lobby();
    await ctx.manager.connect(alice.userId, ctx.roomId);
    await ctx.manager.start(alice.userId, ctx.roomId, aid());
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    expect((await ctx.manager.getSnapshot(alice.userId, ctx.roomId)).game?.result).toMatchObject({
      winnerId: alice.userId,
      reason: 'abandoned',
    });
  });

  it('leaving mid-game is an immediate forfeit; the other player stays as host in the lobby', async () => {
    const ctx = await playing();
    await ctx.manager.leave(alice.userId, ctx.roomId);
    expect(ctx.finished[0]!.result).toEqual({
      outcome: 'win',
      winnerId: bob.userId,
      reason: 'forfeit',
    });
    const snap = await ctx.manager.getSnapshot(bob.userId, ctx.roomId);
    expect(snap.status).toBe('LOBBY');
    expect(snap.hostId).toBe(bob.userId);
    // Leave is idempotent.
    await ctx.manager.leave(alice.userId, ctx.roomId);
    expect(ctx.finished).toHaveLength(1);
  });

  it('getActiveRoom resumes the game after an app reopen', async () => {
    const ctx = await playing();
    const active = await ctx.manager.getActiveRoom(alice.userId);
    expect(active?.roomId).toBe(ctx.roomId);
    expect(active?.status).toBe('IN_GAME');
    expect(await ctx.manager.getActiveRoom(carol.userId)).toBeNull();
  });

  it('versions increase monotonically across every published change', async () => {
    const ctx = await playing();
    await guess(ctx, ctx.first, '9012');
    const versions = ctx.changes.map((c) => c.room.version);
    for (let i = 1; i < versions.length; i++)
      expect(versions[i]!).toBeGreaterThan(versions[i - 1]!);
  });
});

describe('production randomness', () => {
  it('the default CSPRNG source works and stays in [0, 1)', async () => {
    const { RoomManager } = await import('../../src/rooms/roomManager.js');
    const { InMemoryRoomStore } = await import('../../src/rooms/InMemoryRoomStore.js');
    const { pino } = await import('pino');
    const m = new RoomManager(
      new InMemoryRoomStore(),
      { roomChanged() {}, userRemoved() {}, gameFinished() {}, persistRoom() {} },
      pino({ level: 'silent' }),
      { roomTtlMs: TTL_MS, disconnectGraceMs: GRACE_MS },
    );
    const room = await m.createRoom(alice, 'crack-the-code', {});
    await m.joinByInvite(bob, room.inviteToken);
    await m.setReady(bob.userId, room.roomId, true, aid());
    const started = await m.start(alice.userId, room.roomId, aid());
    expect([alice.userId, bob.userId]).toContain(duelView(started.game!.view).firstPlayerId);
    m.shutdown();
  });
});

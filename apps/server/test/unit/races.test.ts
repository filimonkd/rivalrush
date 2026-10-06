import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aid, alice, bob, carol, GRACE_MS, makeManager } from '../helpers/manager.js';
import { code, guess, lobby, opponentSecretOf, playing } from '../helpers/scenarios.js';
import { duelView } from '../helpers/views.js';

/**
 * Concurrency edge cases. Every room mutation runs under that room's lock and first applies
 * any deadline that is already due, so the server's processing order IS the order of events.
 * Each test states the deterministic outcome; docs/testing.md lists them in one table.
 */

const T0 = new Date('2026-10-05T12:00:00Z').getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('race conditions', () => {
  it('1. two guesses at the same time: exactly one is applied, the rest are refused', async () => {
    const ctx = await playing();
    const v = (await ctx.state(ctx.roomId)).version;
    const mk = (who: string, g: string) =>
      ctx.manager.gameAction(who, {
        roomId: ctx.roomId,
        actionId: aid(),
        clientVersion: v,
        action: { type: 'GUESS', guess: g },
      });
    const results = await Promise.all([
      code(mk(ctx.first.userId, '9012')),
      code(mk(ctx.first.userId, '9013')),
      code(mk(ctx.second.userId, '9014')),
    ]);
    // The first in lock order wins; the others are stale (version moved) or out of turn.
    expect(results.filter((r) => r === 'OK')).toHaveLength(1);
    for (const r of results.filter((x) => x !== 'OK'))
      expect(['STALE_GAME_VERSION', 'NOT_YOUR_TURN']).toContain(r);
    const s = await ctx.state(ctx.roomId);
    expect(s.moves).toHaveLength(1);
    expect(s.currentTurn).toBe(ctx.second.userId);
  });

  it('2. a guess arriving exactly at the turn deadline loses to the timeout', async () => {
    const ctx = await playing();
    const s = await ctx.state(ctx.roomId);
    vi.setSystemTime(s.turnDeadlineAt!); // clock reached the deadline; timer callback not run yet
    const r = await code(
      ctx.manager.gameAction(ctx.first.userId, {
        roomId: ctx.roomId,
        actionId: aid(),
        clientVersion: s.version,
        action: { type: 'GUESS', guess: '9012' },
      }),
    );
    // The due timeout is applied first (bumping the version), so the late guess is stale.
    expect(r).toBe('STALE_GAME_VERSION');
    const after = await ctx.state(ctx.roomId);
    expect(after.moves).toEqual([expect.objectContaining({ timedOut: true, guess: null })]);
    expect(after.currentTurn).toBe(ctx.second.userId);

    // One millisecond earlier, the same guess would have counted.
    const ctx2 = await playing();
    vi.setSystemTime((await ctx2.state(ctx2.roomId)).turnDeadlineAt! - 1);
    await guess(ctx2, ctx2.first, '9012');
    expect((await ctx2.state(ctx2.roomId)).moves[0]).toMatchObject({
      guess: '9012',
      timedOut: false,
    });
  });

  it('3. a secret arriving exactly at the setup deadline loses to the auto-generated one', async () => {
    const ctx = await lobby();
    await ctx.manager.connect(alice.userId, ctx.roomId);
    await ctx.manager.connect(bob.userId, ctx.roomId);
    await ctx.manager.start(alice.userId, ctx.roomId, aid());
    const s = await ctx.state(ctx.roomId);
    vi.setSystemTime(s.setupDeadlineAt!);
    const r = await code(
      ctx.manager.gameAction(alice.userId, {
        roomId: ctx.roomId,
        actionId: aid(),
        clientVersion: s.version,
        action: { type: 'SET_SECRET', code: '1234' },
      }),
    );
    expect(r).toBe('GAME_ALREADY_STARTED');
    const after = await ctx.state(ctx.roomId);
    expect(after.phase).toBe('PLAYING');
    expect(after.players.every((p) => p.secret !== null && p.autoSecret)).toBe(true);
  });

  it('4. the same guess sent twice (re-tap after a lost reply) is applied once', async () => {
    const ctx = await playing();
    const v = (await ctx.state(ctx.roomId)).version;
    const send = () =>
      code(
        ctx.manager.gameAction(ctx.first.userId, {
          roomId: ctx.roomId,
          actionId: aid(), // a re-tap gets a new actionId
          clientVersion: v, // …but still carries the version the client saw
          action: { type: 'GUESS', guess: '9012' },
        }),
      );
    expect(await send()).toBe('OK');
    expect(await send()).toBe('STALE_GAME_VERSION');
    // Even with a fresh version it is no longer their turn; and once it is, it's a duplicate.
    expect(await code(guess(ctx, ctx.first, '9012'))).toBe('NOT_YOUR_TURN');
    await guess(ctx, ctx.second, '9012');
    expect(await code(guess(ctx, ctx.first, '9012'))).toBe('DUPLICATE_GUESS');
    expect(
      (await ctx.state(ctx.roomId)).moves.filter((m) => m.playerId === ctx.first.userId),
    ).toHaveLength(1);
  });

  it('5. the same actionId delivered twice (network retry) is applied once, even concurrently', async () => {
    const ctx = await playing();
    const v = (await ctx.state(ctx.roomId)).version;
    const payload = {
      roomId: ctx.roomId,
      actionId: aid(),
      clientVersion: v,
      action: { type: 'GUESS', guess: '9012' },
    };
    const [a, b] = await Promise.all([
      ctx.manager.gameAction(ctx.first.userId, payload),
      ctx.manager.gameAction(ctx.first.userId, payload),
    ]);
    // Both replies succeed with the same board; the move exists once.
    expect(duelView(a.game!.view).moves).toHaveLength(1);
    expect(duelView(b.game!.view).moves).toHaveLength(1);
    expect((await ctx.state(ctx.roomId)).moves).toHaveLength(1);
  });

  it('6. duplicate rematch requests start exactly one new game', async () => {
    const ctx = await playing();
    await ctx.manager.gameAction(ctx.first.userId, {
      roomId: ctx.roomId,
      actionId: aid(),
      clientVersion: 0,
      action: { type: 'FORFEIT' },
    });
    const oldSession = (await ctx.raw(ctx.roomId)).game!.sessionId;
    const idA = aid();
    await Promise.all([
      ctx.manager.rematch(alice.userId, ctx.roomId, idA),
      ctx.manager.rematch(alice.userId, ctx.roomId, idA),
      ctx.manager.rematch(alice.userId, ctx.roomId, aid()),
    ]);
    expect((await ctx.raw(ctx.roomId)).status).toBe('FINISHED');
    const votes = await Promise.all([
      code(ctx.manager.rematch(bob.userId, ctx.roomId, aid())),
      code(ctx.manager.rematch(bob.userId, ctx.roomId, aid())),
    ]);
    // The first vote starts the game; the late duplicate is refused (no game is ending now).
    expect(votes.sort()).toEqual(['OK', 'REMATCH_UNAVAILABLE']);
    const room = await ctx.raw(ctx.roomId);
    expect(room.status).toBe('IN_GAME');
    expect(room.game!.sessionId).not.toBe(oldSession);
    expect(room.gamesPlayed).toBe(1);
    expect(ctx.finished).toHaveLength(1);
  });

  it('7. reconnecting exactly as the turn times out: the timeout applies first, then the player is back', async () => {
    const ctx = await playing();
    await ctx.manager.disconnect(ctx.first.userId, ctx.roomId);
    const s = await ctx.state(ctx.roomId);
    vi.setSystemTime(s.turnDeadlineAt!);
    const snap = await ctx.manager.connect(ctx.first.userId, ctx.roomId);
    expect(duelView(snap.game!.view).moves).toEqual([
      expect.objectContaining({ playerId: ctx.first.userId, timedOut: true }),
    ]);
    expect(duelView(snap.game!.view).currentTurn).toBe(ctx.second.userId);
    expect(duelView(snap.game!.view).turnDeadlineAt).toBe(s.turnDeadlineAt! + 45_000);
    expect(snap.players.find((p) => p.userId === ctx.first.userId)).toMatchObject({
      online: true,
      graceDeadlineAt: null,
    });
    expect(snap.game!.result).toBeNull();
  });

  it('8. a disconnect racing the game end never starts a grace timer or a second result', async () => {
    const ctx = await playing();
    await Promise.all([
      ctx.manager.gameAction(alice.userId, {
        roomId: ctx.roomId,
        actionId: aid(),
        clientVersion: 0,
        action: { type: 'FORFEIT' },
      }),
      ctx.manager.disconnect(alice.userId, ctx.roomId),
    ]);
    const snap = await ctx.manager.getSnapshot(bob.userId, ctx.roomId);
    expect(snap.game?.result?.reason).toBe('forfeit');
    expect(snap.players.every((p) => p.graceDeadlineAt === null)).toBe(true);
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2);
    expect(ctx.finished).toHaveLength(1);

    // Same with the winning guess instead of a forfeit.
    const ctx2 = await playing();
    await guess(ctx2, ctx2.first, '9012');
    await Promise.all([
      guess(ctx2, ctx2.second, opponentSecretOf(ctx2.second)),
      ctx2.manager.disconnect(ctx2.first.userId, ctx2.roomId),
    ]);
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2);
    expect(ctx2.finished).toHaveLength(1);
    expect(ctx2.finished[0]!.result).toMatchObject({
      winnerId: ctx2.second.userId,
      reason: 'cracked',
    });
  });

  it('9. the host leaving while someone joins: either the joiner gets the room or a clear "closed"', async () => {
    for (let i = 0; i < 10; i++) {
      const { manager, store } = makeManager(i);
      const room = await manager.createRoom(alice, 'crack-the-code', {});
      const [, join] = await Promise.all([
        manager.leave(alice.userId, room.roomId),
        code(manager.joinByInvite(carol, room.inviteToken)),
      ]);
      const after = (await store.get(room.roomId))!;
      if (join === 'OK') {
        // Join landed first: Carol is alone and is the host of an open lobby.
        expect(after.status).toBe('LOBBY');
        expect(after.hostId).toBe(carol.userId);
        expect(after.seats.map((s) => s.userId)).toEqual([carol.userId]);
      } else {
        // Leave landed first: the empty room closed and the joiner is told so.
        expect(join).toBe('ROOM_CLOSED');
        expect(after.status).toBe('CLOSED');
        expect(after.seats).toEqual([]);
      }
    }
    // Both orders, forced explicitly.
    const m1 = makeManager();
    const r1 = await m1.manager.createRoom(alice, 'crack-the-code', {});
    await m1.manager.joinByInvite(carol, r1.inviteToken);
    await m1.manager.leave(alice.userId, r1.roomId);
    expect((await m1.store.get(r1.roomId))!.hostId).toBe(carol.userId);
    const m2 = makeManager();
    const r2 = await m2.manager.createRoom(alice, 'crack-the-code', {});
    await m2.manager.leave(alice.userId, r2.roomId);
    expect(await code(m2.manager.joinByInvite(carol, r2.inviteToken))).toBe('ROOM_CLOSED');
  });

  it('9b. two players join the last seat at once: exactly one gets it', async () => {
    const { manager } = makeManager();
    const room = await manager.createRoom(alice, 'crack-the-code', {});
    const results = await Promise.all([
      code(manager.joinByInvite(bob, room.inviteToken)),
      code(manager.joinByInvite(carol, room.inviteToken)),
    ]);
    expect(results.sort()).toEqual(['OK', 'ROOM_FULL']);
  });

  it('10a. "ready" and "start" at the same time: start only succeeds if ready landed first', async () => {
    for (let i = 0; i < 10; i++) {
      const { manager, store } = makeManager(i);
      const room = await manager.createRoom(alice, 'crack-the-code', {});
      await manager.joinByInvite(bob, room.inviteToken);
      const [ready, start] = await Promise.all([
        code(manager.setReady(bob.userId, room.roomId, true, aid())),
        code(manager.start(alice.userId, room.roomId, aid())),
      ]);
      expect(ready).toBe('OK');
      const after = (await store.get(room.roomId))!;
      if (start === 'OK') expect(after.status).toBe('IN_GAME');
      else {
        expect(start).toBe('NOT_READY');
        expect(after.status).toBe('READY');
        expect(after.game).toBeNull();
      }
    }
  });

  it('10b. both players giving up at once: one forfeit decides, the other is refused', async () => {
    const ctx = await playing();
    const forfeit = (who: string) =>
      code(
        ctx.manager.gameAction(who, {
          roomId: ctx.roomId,
          actionId: aid(),
          clientVersion: 0,
          action: { type: 'FORFEIT' },
        }),
      );
    const [a, b] = await Promise.all([forfeit(alice.userId), forfeit(bob.userId)]);
    expect([a, b].sort()).toEqual(['GAME_FINISHED', 'OK']);
    // Whoever's forfeit was processed first loses; the other's arrives at a finished game.
    const winner = a === 'OK' ? bob : alice;
    expect(ctx.finished).toHaveLength(1);
    expect(ctx.finished[0]!.result).toEqual({
      outcome: 'win',
      winnerId: winner.userId,
      reason: 'forfeit',
    });
  });

  it('10c. a guess racing the opponent leaving: the game ends exactly once', async () => {
    const ctx = await playing();
    await Promise.all([
      code(guess(ctx, ctx.first, '9012')),
      ctx.manager.leave(ctx.second.userId, ctx.roomId),
    ]);
    expect(ctx.finished).toHaveLength(1);
    expect(ctx.finished[0]!.result).toMatchObject({
      winnerId: ctx.first.userId,
      reason: 'forfeit',
    });
    const room = await ctx.raw(ctx.roomId);
    expect(room.status).toBe('LOBBY');
    expect(room.game).toBeNull();
  });
});

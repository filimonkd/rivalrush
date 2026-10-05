import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CtcPlayerView } from '@rivalrush/shared';
import { aid, alice, bob, carol, GRACE_MS } from '../helpers/manager.js';
import {
  code,
  guess,
  lockSecrets,
  opponentSecretOf,
  playing,
  type Playing,
} from '../helpers/scenarios.js';

const T0 = new Date('2026-10-05T12:00:00Z').getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

type Ending = 'win' | 'draw (out of guesses)' | 'last-chance win' | 'last-chance draw' | 'forfeit';

/** Plays the current game of `ctx` to the given ending. */
async function finish(ctx: Playing, ending: Ending): Promise<void> {
  const { first, second } = ctx;
  switch (ending) {
    case 'win':
      await guess(ctx, first, '9012');
      await guess(ctx, second, opponentSecretOf(second));
      return;
    case 'last-chance win':
      await guess(ctx, first, opponentSecretOf(first));
      await guess(ctx, second, '9012');
      return;
    case 'last-chance draw':
      await guess(ctx, first, opponentSecretOf(first));
      await guess(ctx, second, opponentSecretOf(second));
      return;
    case 'draw (out of guesses)': {
      const misses = ['9012', '9013', '9014', '9015', '9016', '9017', '9018', '9021'];
      for (const g of misses) {
        await guess(ctx, first, g);
        await guess(ctx, second, g);
      }
      return;
    }
    case 'forfeit':
      await ctx.manager.gameAction(first.userId, {
        roomId: ctx.roomId,
        actionId: aid(),
        clientVersion: 0,
        action: { type: 'FORFEIT' },
      });
      return;
  }
}

const EXPECTED: Record<Ending, (c: Playing) => object> = {
  win: (c) => ({ outcome: 'win', winnerId: c.second.userId, reason: 'cracked' }),
  'draw (out of guesses)': () => ({ outcome: 'draw', winnerId: null, reason: 'out_of_guesses' }),
  'last-chance win': (c) => ({ outcome: 'win', winnerId: c.first.userId, reason: 'cracked' }),
  'last-chance draw': () => ({ outcome: 'draw', winnerId: null, reason: 'both_cracked' }),
  forfeit: (c) => ({ outcome: 'win', winnerId: c.second.userId, reason: 'forfeit' }),
};

describe('rematch after every kind of ending', () => {
  it.each<Ending>([
    'win',
    'draw (out of guesses)',
    'last-chance win',
    'last-chance draw',
    'forfeit',
  ])(
    'after a %s: both agree → a fresh game, same room and players, other player first',
    async (ending) => {
      const ctx = await playing(3, { maxGuesses: 8 });
      await finish(ctx, ending);
      const done = await ctx.raw(ctx.roomId);
      expect(done.status).toBe('FINISHED');
      expect(done.game!.result).toEqual(EXPECTED[ending](ctx));
      const old = structuredClone(done.game!);

      // Bob asks first this time; Alice accepts.
      const afterBob = await ctx.manager.rematch(bob.userId, ctx.roomId, aid());
      expect(afterBob.status).toBe('FINISHED');
      expect(afterBob.players.find((p) => p.userId === bob.userId)?.wantsRematch).toBe(true);
      const started = await ctx.manager.rematch(alice.userId, ctx.roomId, aid());

      // Same room and identities, brand-new session.
      expect(started.roomId).toBe(ctx.roomId);
      expect(started.status).toBe('IN_GAME');
      expect(started.players.map((p) => p.userId).sort()).toEqual(
        [alice.userId, bob.userId].sort(),
      );
      expect(started.players.every((p) => !p.wantsRematch)).toBe(true);
      const room = await ctx.raw(ctx.roomId);
      expect(room.game!.sessionId).not.toBe(old.sessionId);
      expect(room.game!.isRematch).toBe(true);
      expect(room.gamesPlayed).toBe(1);

      // Nothing from the previous game leaks into the new one.
      for (const viewer of [alice, bob]) {
        const snap = await ctx.manager.getSnapshot(viewer.userId, ctx.roomId);
        const view = snap.game!.view as CtcPlayerView;
        expect(snap.game!.result).toBeNull();
        expect(view).toMatchObject({
          phase: 'SETUP',
          moves: [],
          result: null,
          mySecret: null,
          opponentSecret: null,
          currentTurn: null,
        });
        expect(view.players.every((p) => p.turnsUsed === 0 && !p.cracked && !p.hasSecret)).toBe(
          true,
        );
      }
      // The starting player swaps.
      expect(room.game!.firstPlayerId).toBe(ctx.second.userId);

      // The finished game was handed to the recorder once and is not touched again.
      expect(ctx.finished).toHaveLength(1);
      expect(ctx.finished[0]!.sessionId).toBe(old.sessionId);
      expect(ctx.finished[0]!.result).toEqual(old.result);

      // The rematch plays to its own result and is recorded as a separate session.
      const next = await lockSecrets(ctx);
      expect(next.first).toBe(ctx.second);
      await guess(next, next.first, '9012');
      await guess(next, next.second, opponentSecretOf(next.second));
      expect(ctx.finished).toHaveLength(2);
      expect(ctx.finished[1]!.sessionId).toBe(room.game!.sessionId);
      expect(ctx.finished[1]!.isRematch).toBe(true);
    },
  );

  it('the starting player alternates over a run of rematches', async () => {
    const ctx = await playing(5);
    const firsts = [ctx.first.userId];
    let cur: Playing = ctx;
    for (let i = 0; i < 3; i++) {
      await finish(cur, 'forfeit');
      await ctx.manager.rematch(alice.userId, ctx.roomId, aid());
      await ctx.manager.rematch(bob.userId, ctx.roomId, aid());
      cur = await lockSecrets(ctx);
      firsts.push(cur.first.userId);
    }
    expect(firsts[1]).not.toBe(firsts[0]);
    expect(firsts[2]).toBe(firsts[0]);
    expect(firsts[3]).toBe(firsts[1]);
    expect(new Set(ctx.finished.map((f) => f.sessionId)).size).toBe(3);
  });
});

describe('rematch agreement', () => {
  it('a vote on its own changes nothing but the vote; repeated votes are no-ops', async () => {
    const ctx = await playing();
    await finish(ctx, 'win');
    const id = aid();
    await ctx.manager.rematch(alice.userId, ctx.roomId, id);
    const v = (await ctx.raw(ctx.roomId)).version;
    await ctx.manager.rematch(alice.userId, ctx.roomId, id); // same actionId (network retry)
    await ctx.manager.rematch(alice.userId, ctx.roomId, aid()); // double tap
    const room = await ctx.raw(ctx.roomId);
    expect(room.version).toBe(v);
    expect(room.status).toBe('FINISHED');
    expect(ctx.finished).toHaveLength(1);
  });

  it('one wants a rematch, the other leaves: no game starts and the leaver is never pulled back', async () => {
    const ctx = await playing();
    await finish(ctx, 'win');
    await ctx.manager.rematch(alice.userId, ctx.roomId, aid());
    await ctx.manager.leave(bob.userId, ctx.roomId);

    const snap = await ctx.manager.getSnapshot(alice.userId, ctx.roomId);
    expect(snap.status).toBe('LOBBY');
    expect(snap.hostId).toBe(alice.userId);
    expect(snap.players).toHaveLength(1);
    expect(snap.players[0]!.wantsRematch).toBe(false);
    // The finished game is recorded already; the lobby no longer carries it.
    expect(snap.game).toBeNull();
    expect(await code(ctx.manager.rematch(alice.userId, ctx.roomId, aid()))).toBe(
      'REMATCH_UNAVAILABLE',
    );
    expect(await code(ctx.manager.getSnapshot(bob.userId, ctx.roomId))).toBe('NOT_ROOM_MEMBER');
    expect(ctx.finished).toHaveLength(1);
  });

  it('a newcomer joining through the old invite sees nothing of the previous match', async () => {
    const ctx = await playing();
    await finish(ctx, 'last-chance win');
    await ctx.manager.leave(bob.userId, ctx.roomId);
    const joined = await ctx.manager.joinByInvite(carol, ctx.inviteToken);
    expect(joined.game).toBeNull();
    expect(JSON.stringify(joined)).not.toMatch(/1234|5678|9012/);
    // A fresh game with the newcomer starts from a random (not inherited) first player.
    await ctx.manager.setReady(carol.userId, ctx.roomId, true, aid());
    const started = await ctx.manager.start(alice.userId, ctx.roomId, aid());
    expect(started.game!.view).toMatchObject({ phase: 'SETUP', moves: [] });
    expect((await ctx.raw(ctx.roomId)).game!.isRematch).toBe(false);
  });

  it('one player disconnects while waiting: the vote stands and they get the usual grace', async () => {
    const ctx = await playing();
    await finish(ctx, 'win');
    await ctx.manager.rematch(alice.userId, ctx.roomId, aid());
    await ctx.manager.disconnect(alice.userId, ctx.roomId);

    // Bob sees Alice offline (no grace timer outside a live game) but still wanting a rematch.
    let snap = await ctx.manager.getSnapshot(bob.userId, ctx.roomId);
    expect(snap.players.find((p) => p.userId === alice.userId)).toMatchObject({
      online: false,
      wantsRematch: true,
      graceDeadlineAt: null,
    });
    await vi.advanceTimersByTimeAsync(GRACE_MS * 3);
    expect((await ctx.raw(ctx.roomId)).status).toBe('FINISHED');

    // Bob accepts: the game starts and the absent Alice gets the normal reconnect grace.
    snap = await ctx.manager.rematch(bob.userId, ctx.roomId, aid());
    expect(snap.status).toBe('IN_GAME');
    expect(snap.players.find((p) => p.userId === alice.userId)?.graceDeadlineAt).toBe(
      Date.now() + GRACE_MS,
    );
    await vi.advanceTimersByTimeAsync(GRACE_MS / 2);
    snap = await ctx.manager.connect(alice.userId, ctx.roomId);
    expect(snap.players.every((p) => p.graceDeadlineAt === null)).toBe(true);
    expect(snap.game!.result).toBeNull();
  });

  it('a player who never comes back after agreeing loses the rematch by abandonment', async () => {
    const ctx = await playing();
    await finish(ctx, 'win');
    await ctx.manager.rematch(alice.userId, ctx.roomId, aid());
    await ctx.manager.disconnect(alice.userId, ctx.roomId);
    await ctx.manager.rematch(bob.userId, ctx.roomId, aid());
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    const room = await ctx.raw(ctx.roomId);
    expect(room.game!.result).toEqual({
      outcome: 'win',
      winnerId: bob.userId,
      reason: 'abandoned',
    });
    expect(ctx.finished).toHaveLength(2);
    expect(ctx.finished[1]!.result.reason).toBe('abandoned');
  });

  it('a rematch vote racing the opponent leaving never starts a one-player game', async () => {
    const ctx = await playing();
    await finish(ctx, 'win');
    await ctx.manager.rematch(bob.userId, ctx.roomId, aid());
    const [vote] = await Promise.all([
      code(ctx.manager.rematch(alice.userId, ctx.roomId, aid())),
      ctx.manager.leave(bob.userId, ctx.roomId),
    ]);
    const room = await ctx.raw(ctx.roomId);
    if (vote === 'OK') {
      // Alice's vote landed first: the rematch started, then Bob's leave forfeited it.
      expect(ctx.finished).toHaveLength(2);
      expect(ctx.finished[1]!.result).toMatchObject({ winnerId: alice.userId, reason: 'forfeit' });
    } else {
      expect(vote).toBe('REMATCH_UNAVAILABLE');
      expect(ctx.finished).toHaveLength(1);
    }
    expect(room.status).toBe('LOBBY');
    expect(room.seats.map((s) => s.userId)).toEqual([alice.userId]);
    expect(room.game).toBeNull();
  });
});

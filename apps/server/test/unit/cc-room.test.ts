import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CcState } from '../../src/games/color-cipher/game.js';
import { aid, alice, bob, carol, GRACE_MS, makeManager } from '../helpers/manager.js';
import { code } from '../helpers/scenarios.js';
import { duelView } from '../helpers/views.js';

/**
 * Color Cipher through the unchanged platform: RoomManager, timers, presence, rematch and
 * match recording. Nothing here is game-specific infrastructure.
 */

const T0 = new Date('2026-10-05T12:00:00Z').getTime();
const TURN_MS = 45_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

const PATTERNS: Record<string, string> = { [alice.userId]: '0034', [bob.userId]: '2241' };
const opponentPattern = (userId: string) =>
  userId === alice.userId ? PATTERNS[bob.userId]! : PATTERNS[alice.userId]!;

async function ccPlaying(seed = 1) {
  const ctx = makeManager(seed);
  const created = await ctx.manager.createRoom(alice, 'color-cipher', { turnSeconds: 45 });
  const { roomId, inviteToken } = created;
  await ctx.manager.joinByInvite(bob, inviteToken);
  await ctx.manager.setReady(bob.userId, roomId, true, aid());
  await ctx.manager.connect(alice.userId, roomId);
  await ctx.manager.connect(bob.userId, roomId);
  await ctx.manager.start(alice.userId, roomId, aid());
  const state = async () => (await ctx.raw(roomId)).game!.state as CcState;
  for (const who of [alice, bob]) {
    await ctx.manager.gameAction(who.userId, {
      roomId,
      actionId: aid(),
      clientVersion: 0,
      action: { type: 'SET_SECRET', pattern: PATTERNS[who.userId] },
    });
  }
  const s = await state();
  const first = s.currentTurn === alice.userId ? alice : bob;
  const second = first === alice ? bob : alice;
  const guess = async (who: { userId: string }, pattern: string, actionId = aid()) =>
    ctx.manager.gameAction(who.userId, {
      roomId,
      actionId,
      clientVersion: (await state()).version,
      action: { type: 'GUESS', pattern },
    });
  return { ...ctx, roomId, inviteToken, created, state, first, second, guess };
}

describe('Color Cipher on the platform', () => {
  it('creates a color-cipher room with its own settings and an invite that previews the game', async () => {
    const { manager, created } = await ccPlaying();
    expect(created.gameType).toBe('color-cipher');
    expect(created.settings).toEqual({
      patternLength: 4,
      colorCount: 6,
      turnSeconds: 45,
      maxGuesses: 10,
    });
    const preview = await manager.getInvitePreview(carol.userId, created.inviteToken);
    expect(preview).toMatchObject({
      gameType: 'color-cipher',
      joinable: false,
      reason: 'GAME_ALREADY_STARTED',
    });
    expect(await code(manager.createRoom(carol, 'color-cipher', { patternLength: 5 }))).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('plays to a result and records it once, as color-cipher, with no patterns', async () => {
    const ctx = await ccPlaying();
    await ctx.guess(ctx.first, '5555');
    const end = await ctx.guess(ctx.second, opponentPattern(ctx.second.userId));
    expect(end.status).toBe('FINISHED');
    expect(end.game!.result).toEqual({
      outcome: 'win',
      winnerId: ctx.second.userId,
      reason: 'cracked',
    });
    expect(ctx.finished).toHaveLength(1);
    const rec = ctx.finished[0]!;
    expect(rec.gameType).toBe('color-cipher');
    expect(rec.moves).toEqual([
      expect.objectContaining({ playerId: ctx.first.userId, guess: '5555', exact: 0, partial: 0 }),
      expect.objectContaining({ playerId: ctx.second.userId, exact: 4, partial: 0 }),
    ]);
    // The second player's pattern was never guessed, so it must not appear anywhere.
    expect(JSON.stringify(rec)).not.toContain(PATTERNS[ctx.second.userId]);
    expect(JSON.stringify(rec)).not.toMatch(/secret/i);
  });

  it('live snapshots never contain the opponent pattern', async () => {
    const ctx = await ccPlaying();
    await ctx.guess(ctx.first, '5555');
    for (const viewer of [alice, bob]) {
      const snap = await ctx.manager.getSnapshot(viewer.userId, ctx.roomId);
      expect(duelView(snap.game!.view).opponentSecret).toBeNull();
      const scrubbed = {
        ...snap,
        game: { ...snap.game, view: { ...duelView(snap.game!.view), moves: [] } },
      };
      expect(JSON.stringify(scrubbed)).not.toContain(opponentPattern(viewer.userId));
      expect(duelView(snap.game!.view).mySecret).toBe(PATTERNS[viewer.userId]);
    }
  });

  it('turn order, stale versions and duplicate actionIds are enforced by the platform', async () => {
    const ctx = await ccPlaying();
    const s = await ctx.state();
    expect(
      await code(
        ctx.manager.gameAction(ctx.second.userId, {
          roomId: ctx.roomId,
          actionId: aid(),
          clientVersion: s.version,
          action: { type: 'GUESS', pattern: '0000' },
        }),
      ),
    ).toBe('NOT_YOUR_TURN');
    const id = aid();
    await ctx.guess(ctx.first, '1111', id);
    const again = await ctx.manager.gameAction(ctx.first.userId, {
      roomId: ctx.roomId,
      actionId: id,
      clientVersion: s.version,
      action: { type: 'GUESS', pattern: '1111' },
    });
    expect(duelView(again.game!.view).moves).toHaveLength(1);
    expect(
      await code(
        ctx.manager.gameAction(ctx.second.userId, {
          roomId: ctx.roomId,
          actionId: aid(),
          clientVersion: s.version,
          action: { type: 'GUESS', pattern: '2222' },
        }),
      ),
    ).toBe('STALE_GAME_VERSION');
  });

  it('server turn timer and setup timer drive Color Cipher too', async () => {
    const ctx = await ccPlaying();
    await vi.advanceTimersByTimeAsync(TURN_MS);
    const s = await ctx.state();
    expect(s.moves).toEqual([
      expect.objectContaining({ playerId: ctx.first.userId, timedOut: true }),
    ]);
    expect(s.currentTurn).toBe(ctx.second.userId);

    const ctx2 = makeManager(2);
    const r = await ctx2.manager.createRoom(alice, 'color-cipher', {});
    await ctx2.manager.joinByInvite(bob, r.inviteToken);
    await ctx2.manager.setReady(bob.userId, r.roomId, true, aid());
    await ctx2.manager.connect(alice.userId, r.roomId);
    await ctx2.manager.connect(bob.userId, r.roomId);
    await ctx2.manager.start(alice.userId, r.roomId, aid());
    await vi.advanceTimersByTimeAsync(60_000);
    const s2 = (await ctx2.raw(r.roomId)).game!.state as CcState;
    expect(s2.phase).toBe('PLAYING');
    expect(s2.players.every((x) => x.autoSecret && /^[0-5]{4}$/.test(x.secret!))).toBe(true);
  });

  it('disconnect during setup, own turn and opponent turn: back within grace = continue', async () => {
    const ctx = await ccPlaying();
    // Own turn: the first player drops, comes back before both the turn and grace run out.
    await ctx.manager.disconnect(ctx.first.userId, ctx.roomId);
    await vi.advanceTimersByTimeAsync(20_000);
    let snap = await ctx.manager.connect(ctx.first.userId, ctx.roomId);
    expect(duelView(snap.game!.view).currentTurn).toBe(ctx.first.userId);
    expect(snap.players.every((p) => p.graceDeadlineAt === null)).toBe(true);
    // Opponent's turn: the first player drops while waiting, returns after their timeout.
    await ctx.guess(ctx.first, '5555');
    await ctx.manager.disconnect(ctx.first.userId, ctx.roomId);
    await vi.advanceTimersByTimeAsync(TURN_MS + 1_000);
    snap = await ctx.manager.connect(ctx.first.userId, ctx.roomId);
    expect(duelView(snap.game!.view).moves.at(-1)).toMatchObject({
      playerId: ctx.second.userId,
      timedOut: true,
    });
    expect(duelView(snap.game!.view).currentTurn).toBe(ctx.first.userId);
    expect(snap.game!.result).toBeNull();
  });

  it('away longer than the grace period = abandoned loss, recorded once', async () => {
    const ctx = await ccPlaying();
    await ctx.manager.disconnect(alice.userId, ctx.roomId);
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    expect(ctx.finished).toHaveLength(1);
    expect(ctx.finished[0]!.result).toMatchObject({ winnerId: bob.userId, reason: 'abandoned' });
  });

  it('rematch: new session, same room and players, new patterns, other player first', async () => {
    const ctx = await ccPlaying();
    const firstBefore = ctx.first.userId;
    await ctx.manager.gameAction(alice.userId, {
      roomId: ctx.roomId,
      actionId: aid(),
      clientVersion: 0,
      action: { type: 'FORFEIT' },
    });
    const oldSession = (await ctx.raw(ctx.roomId)).game!.sessionId;
    await ctx.manager.rematch(bob.userId, ctx.roomId, aid());
    const started = await ctx.manager.rematch(alice.userId, ctx.roomId, aid());
    expect(started.gameType).toBe('color-cipher');
    const room = await ctx.raw(ctx.roomId);
    expect(room.game!.sessionId).not.toBe(oldSession);
    expect(room.game!.isRematch).toBe(true);
    const s = room.game!.state as CcState;
    expect(s.firstPlayerId).not.toBe(firstBefore);
    expect(s.phase).toBe('SETUP');
    expect(s.players.every((p) => p.secret === null && p.turnsUsed === 0)).toBe(true);
    expect(ctx.finished).toHaveLength(1);
  });

  it('runs side by side with Crack the Code rooms', async () => {
    const { manager } = makeManager(4);
    const ctc = await manager.createRoom(alice, 'crack-the-code', {});
    const cc = await manager.createRoom(carol, 'color-cipher', {});
    expect(ctc.gameType).toBe('crack-the-code');
    expect(cc.gameType).toBe('color-cipher');
    expect((await manager.getSnapshot(alice.userId, ctc.roomId)).settings).toHaveProperty(
      'codeLength',
    );
    expect((await manager.getSnapshot(carol.userId, cc.roomId)).settings).toHaveProperty(
      'patternLength',
    );
  });
});

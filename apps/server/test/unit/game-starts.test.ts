import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { GameStartLog, type StartedSession } from '../../src/analytics/gameStarts.js';
import { aid, alice, bob } from '../helpers/manager.js';
import { playing } from '../helpers/scenarios.js';

describe('game starts are reported for the beta metrics', () => {
  it('one record per started game, with metadata only', async () => {
    const ctx = await playing(1);
    const game = (await ctx.raw(ctx.roomId)).game!;
    expect(ctx.started).toEqual([
      {
        sessionId: game.sessionId,
        roomId: ctx.roomId,
        gameType: 'crack-the-code',
        isRematch: false,
        players: 2,
        startedAt: game.startedAt,
      },
    ]);
    // No names, secrets or moves.
    expect(JSON.stringify(ctx.started)).not.toMatch(/Alice|Bob|1234|5678/);
  });

  it('a replayed start is not counted twice; a rematch is a new, flagged start', async () => {
    const ctx = await playing(2);
    await ctx.manager.gameAction(alice.userId, {
      roomId: ctx.roomId,
      actionId: aid(),
      clientVersion: 0,
      action: { type: 'FORFEIT' },
    });
    const replay = aid();
    await ctx.manager.rematch(alice.userId, ctx.roomId, replay);
    await ctx.manager.rematch(bob.userId, ctx.roomId, aid());
    await ctx.manager.rematch(alice.userId, ctx.roomId, replay);
    expect(ctx.started.map((s) => s.isRematch)).toEqual([false, true]);
    expect(new Set(ctx.started.map((s) => s.sessionId)).size).toBe(2);
    expect(ctx.started[1]!.sessionId).toBe((await ctx.raw(ctx.roomId)).game!.sessionId);
  });
});

describe('GameStartLog', () => {
  const session: StartedSession = {
    sessionId: 's1',
    roomId: 'r1',
    gameType: 'crack-the-code',
    isRematch: false,
    players: 2,
    startedAt: 0,
  };

  it('logs a failed write and never throws into gameplay', async () => {
    const lines: string[] = [];
    const logger = pino(
      { level: 'warn' },
      new Writable({
        write(c, _e, cb) {
          lines.push(String(c));
          cb();
        },
      }),
    );
    const log = new GameStartLog(logger, async () => {
      throw new Error('database down');
    });
    expect(() => log.submit(session)).not.toThrow();
    await log.drain();
    expect(lines.join('')).toContain('game start write failed');
    expect(lines.join('')).toContain('"sessionId":"s1"');
  });

  it('drain waits for pending writes', async () => {
    const written: string[] = [];
    const log = new GameStartLog(pino({ level: 'silent' }), async (s) => {
      await new Promise((r) => setTimeout(r, 10));
      written.push(s.sessionId);
    });
    log.submit(session);
    await log.drain();
    expect(written).toEqual(['s1']);
  });
});

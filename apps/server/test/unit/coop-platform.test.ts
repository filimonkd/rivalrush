import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COLOR_CIPHER_ID, CRACK_THE_CODE_ID, DEFUSER_ID } from '@rivalrush/shared';
import { getGame, listGames } from '../../src/games/registry.js';
import { outcomeFor, statsUpdate } from '../../src/matches/matchService.js';
import { nextStartingPlayer } from '../../src/rooms/rotation.js';
import { fakeCoop } from '../helpers/fakeCoop.js';
import { aid, alice, bob, carol, dave, makeManager } from '../helpers/manager.js';
import { code } from '../helpers/scenarios.js';
import type { SeatIdentity } from '../../src/users/userService.js';

const T0 = new Date('2026-10-06T12:00:00Z').getTime();
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

const withFake = (id: string) => (id === fakeCoop.id ? fakeCoop : getGame(id));

/** A started game of `gameType` with `people` seated (host first) and all connected. */
async function started(gameType: string, people: SeatIdentity[], seed = 7) {
  const ctx = makeManager(seed, withFake);
  const room = await ctx.manager.createRoom(people[0]!, gameType, {});
  for (const p of people.slice(1)) {
    await ctx.manager.joinByInvite(p, room.inviteToken);
    await ctx.manager.setReady(p.userId, room.roomId, true, aid());
  }
  for (const p of people) await ctx.manager.connect(p.userId, room.roomId);
  await ctx.manager.start(people[0]!.userId, room.roomId, aid());
  return { ...ctx, roomId: room.roomId };
}

async function rematchAll(ctx: Awaited<ReturnType<typeof started>>, people: SeatIdentity[]) {
  for (const p of people) await ctx.manager.rematch(p.userId, ctx.roomId, aid());
}

const endFake = (ctx: Awaited<ReturnType<typeof started>>, by: SeatIdentity, outcome: string) =>
  ctx.manager.gameAction(by.userId, {
    roomId: ctx.roomId,
    actionId: aid(),
    clientVersion: 0,
    action: { type: 'END', outcome },
  });

describe('nextStartingPlayer (pure)', () => {
  const all = () => true;
  it('2 players swap: A → B → A', () => {
    expect(nextStartingPlayer(['A', 'B'], 'A', all)).toBe('B');
    expect(nextStartingPlayer(['A', 'B'], 'B', all)).toBe('A');
  });
  it('3 and 4 players rotate in seat order', () => {
    expect(nextStartingPlayer(['A', 'B', 'C'], 'A', all)).toBe('B');
    expect(nextStartingPlayer(['A', 'B', 'C'], 'C', all)).toBe('A');
    expect(nextStartingPlayer(['A', 'B', 'C', 'D'], 'C', all)).toBe('D');
    expect(nextStartingPlayer(['A', 'B', 'C', 'D'], 'D', all)).toBe('A');
  });
  it('skips players no longer seated; null when nobody else is seated', () => {
    expect(nextStartingPlayer(['A', 'B', 'C', 'D'], 'A', (p) => p !== 'B')).toBe('C');
    expect(nextStartingPlayer(['A', 'B'], 'A', (p) => p === 'A')).toBeNull();
    expect(nextStartingPlayer(['A', 'B'], 'X', all)).toBeNull();
  });
});

describe('starting-player rotation through RoomManager', () => {
  for (const gameType of [CRACK_THE_CODE_ID, COLOR_CIPHER_ID]) {
    it(`${gameType}: two players still swap on every rematch (unchanged)`, async () => {
      const ctx = await started(gameType, [alice, bob]);
      const starters: string[] = [];
      for (let g = 0; g < 4; g++) {
        const raw = await ctx.raw(ctx.roomId);
        starters.push(raw.game!.firstPlayerId);
        await ctx.manager.gameAction(raw.game!.firstPlayerId, {
          roomId: ctx.roomId,
          actionId: aid(),
          clientVersion: 0,
          action: { type: 'FORFEIT' },
        });
        await rematchAll(ctx, [alice, bob]);
      }
      expect(starters[1]).not.toBe(starters[0]);
      expect(starters[2]).toBe(starters[0]);
      expect(starters[3]).toBe(starters[1]);
    });
  }

  for (const people of [
    [alice, bob],
    [alice, bob, carol],
    [alice, bob, carol, dave],
  ]) {
    it(`${people.length} players rotate in seat order over 5 rematches`, async () => {
      const ctx = await started(fakeCoop.id, people);
      const ids = people.map((p) => p.userId);
      const starters: string[] = [];
      for (let g = 0; g < 6; g++) {
        starters.push((await ctx.raw(ctx.roomId)).game!.firstPlayerId);
        await endFake(ctx, people[0]!, 'defused');
        await rematchAll(ctx, people);
      }
      const first = ids.indexOf(starters[0]!);
      expect(starters).toEqual(starters.map((_, i) => ids[(first + i) % ids.length]));
    });
  }
});

describe('player snapshot and co-op recording data', () => {
  it('a player who leaves mid-game keeps their name, role and status in the finished session', async () => {
    const people = [alice, bob, carol];
    const ctx = await started(fakeCoop.id, people);
    await ctx.manager.leave(carol.userId, ctx.roomId);
    await endFake(ctx, alice, 'defused');
    expect(ctx.finished).toHaveLength(1);
    const s = ctx.finished[0]!;
    expect(s.players.map((p) => p.displayName)).toEqual(['Alice', 'Bob', 'Carol']);
    const c = s.players.find((p) => p.userId === carol.userId)!;
    expect(c.coop).toMatchObject({ finalStatus: 'left' });
    expect(s.result).toMatchObject({ kind: 'coop', outcome: 'defused' });
    expect(outcomeFor(s.result, carol.userId)).toBe('coop_dropped');
    expect(outcomeFor(s.result, alice.userId)).toBe('coop_win');
    expect(s.generator).toEqual({ version: 1, seed: '00112233445566778899aabbccddeeff' });
  });

  it('fewer than 2 active players ends the co-op game ABANDONED (no contest)', async () => {
    const ctx = await started(fakeCoop.id, [alice, bob]);
    await ctx.manager.leave(bob.userId, ctx.roomId);
    const s = ctx.finished[0]!;
    expect(s.result).toMatchObject({ kind: 'coop', outcome: 'abandoned', reason: 'abandoned' });
    expect(outcomeFor(s.result, alice.userId)).toBe('coop_unfinished');
    expect(outcomeFor(s.result, bob.userId)).toBe('coop_dropped');
  });

  it('duel sessions carry no co-op data and no generator info', async () => {
    const ctx = await started(CRACK_THE_CODE_ID, [alice, bob]);
    await ctx.manager.gameAction(alice.userId, {
      roomId: ctx.roomId,
      actionId: aid(),
      clientVersion: 0,
      action: { type: 'FORFEIT' },
    });
    const s = ctx.finished[0]!;
    expect(s.players.every((p) => p.coop === undefined)).toBe(true);
    expect(s.generator).toBeUndefined();
    expect(outcomeFor(s.result, bob.userId)).toBe('win');
    expect(outcomeFor(s.result, alice.userId)).toBe('loss');
  });
});

describe('stats updates', () => {
  const keysOf = (outcome: Parameters<typeof statsUpdate>[0]) =>
    Object.keys((statsUpdate(outcome)[0] as { $set: Record<string, unknown> }).$set).sort();
  const COMPETITIVE = [
    'stats.gamesPlayed',
    'stats.wins',
    'stats.losses',
    'stats.draws',
    'stats.currentStreak',
    'stats.bestStreak',
  ];

  it('co-op results touch only stats.coop.*, never a competitive field', () => {
    expect(keysOf('coop_win')).toEqual(['stats.coop.played', 'stats.coop.wins']);
    expect(keysOf('coop_loss')).toEqual(['stats.coop.losses', 'stats.coop.played']);
    expect(keysOf('coop_unfinished')).toEqual(['stats.coop.played']);
    expect(keysOf('coop_dropped')).toEqual(['stats.coop.dropped', 'stats.coop.played']);
    for (const o of ['coop_win', 'coop_loss', 'coop_unfinished', 'coop_dropped'] as const) {
      expect(keysOf(o).some((k) => COMPETITIVE.includes(k))).toBe(false);
    }
  });

  it('duel results update the competitive fields exactly as before', () => {
    expect(keysOf('win')).toEqual([
      'stats.bestStreak',
      'stats.currentStreak',
      'stats.gamesPlayed',
      'stats.wins',
    ]);
    expect(keysOf('loss')).toEqual(['stats.currentStreak', 'stats.gamesPlayed', 'stats.losses']);
    expect(keysOf('draw')).toEqual(['stats.currentStreak', 'stats.draws', 'stats.gamesPlayed']);
  });
});

describe('Defuser registry status (foundation only)', () => {
  it('is known to the catalog as coming soon, but has no playable plug-in', async () => {
    expect(getGame(DEFUSER_ID)).toBeNull();
    expect(listGames().find((g) => g.id === DEFUSER_ID)).toMatchObject({
      status: 'coming_soon',
      minPlayers: 2,
      maxPlayers: 4,
      tagline: 'Your crew vs. the clock.',
    });
    const ctx = makeManager();
    expect(await code(ctx.manager.createRoom(alice, DEFUSER_ID, {}))).toBe('GAME_NOT_AVAILABLE');
  });
});

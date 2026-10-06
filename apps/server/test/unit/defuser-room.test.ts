import type { DefuserPlayerView, RoomSnapshot } from '@rivalrush/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefuser } from '../../src/games/defuser/game.js';
import type { DefuserState } from '../../src/games/defuser/state.js';
import { getGame } from '../../src/games/registry.js';
import { SEED, solutionOf } from '../helpers/defuser.js';
import { aid, alice, bob, carol, dave, GRACE_MS, makeManager } from '../helpers/manager.js';
import { code } from '../helpers/scenarios.js';

const T0 = new Date('2026-10-06T12:00:00Z').getTime();
const BRIEF = 20_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

const defuser = createDefuser({ fixedSeed: SEED });
const lookup = (id: string) => (id === 'defuser' ? defuser : getGame(id));
const ALL = [alice, bob, carol, dave];

/** A started Defuser game with `n` connected players (Alice hosts). */
async function started(n: number, seed = 1) {
  const ctx = makeManager(seed, lookup);
  const people = ALL.slice(0, n);
  const room = await ctx.manager.createRoom(alice, 'defuser', {});
  for (const p of people.slice(1)) {
    await ctx.manager.joinByInvite(p, room.inviteToken);
    await ctx.manager.setReady(p.userId, room.roomId, true, aid());
  }
  for (const p of people) await ctx.manager.connect(p.userId, room.roomId);
  await ctx.manager.start(alice.userId, room.roomId, aid());
  const game = async () => (await ctx.raw(room.roomId)).game!.state as DefuserState;
  const act = (userId: string, action: unknown, actionId = aid()) =>
    ctx.manager.gameAction(userId, { roomId: room.roomId, actionId, clientVersion: 0, action });
  const view = async (userId: string) =>
    (await ctx.manager.getSnapshot(userId, room.roomId)).game!.view as DefuserPlayerView;
  const ids = people.map((p) => p.userId);
  const op = async () => (await game()).operatorId;
  const analysts = async () =>
    (await game()).players
      .filter((p) => p.status === 'active' && p.role === 'analyst')
      .sort((a, b) => a.letter!.localeCompare(b.letter!))
      .map((p) => p.id);
  const armAll = async () => {
    for (const id of ids) await act(id, { type: 'READY' });
    expect((await game()).phase).toBe('ARMED');
  };
  return { ...ctx, roomId: room.roomId, people, ids, game, act, view, op, analysts, armAll };
}

describe('Defuser in RoomManager', () => {
  it('is not playable from the default registry (GAME_NOT_AVAILABLE)', async () => {
    const { manager } = makeManager();
    expect(await code(manager.createRoom(alice, 'defuser', {}))).toBe('GAME_NOT_AVAILABLE');
  });

  it('a 4-seat room starts with every player getting their own view in the same version', async () => {
    const g = await started(4);
    const snaps: RoomSnapshot[] = [];
    for (const id of g.ids) snaps.push(await g.manager.getSnapshot(id, g.roomId));
    expect(new Set(snaps.map((s) => s.version)).size).toBe(1);
    const kinds = snaps.map((s) => (s.game!.view as DefuserPlayerView).kind).sort();
    expect(kinds).toEqual(['analyst', 'analyst', 'analyst', 'operator']);
    expect(snaps[0]!.maxPlayers).toBe(4);
  });

  it('every action is version-independent: a stale clientVersion is still applied', async () => {
    const g = await started(2);
    await g.act(g.ids[0]!, { type: 'READY' });
    const snap = await g.act(g.ids[1]!, { type: 'READY' });
    expect((snap.game!.view as DefuserPlayerView).phase).toBe('ARMED');
  });

  it('duplicate actionId → the current snapshot, applied once', async () => {
    const g = await started(2);
    await g.armAll();
    const op = await g.op();
    const wrong = [1, 2, 3, 4, 5].find((l) => l !== solutionOf(SEED, 1).fuse.line)!;
    const id = aid();
    await g.act(op, { type: 'CUT_LINE', line: wrong }, id);
    await g.act(op, { type: 'CUT_LINE', line: wrong }, id);
    expect((await g.game()).faults).toBe(1);
  });

  it('events of one accepted action share its room version and arrive in spec order', async () => {
    const g = await started(3);
    await g.armAll();
    const op = await g.op();
    const s = solutionOf(SEED, 2);
    await g.act(op, { type: 'CUT_LINE', line: s.fuse.line });
    await g.act(op, { type: 'PRESS_GLYPH', key: s.glyph.first });
    await g.act(op, { type: 'PRESS_GLYPH', key: s.glyph.second });
    g.changes.length = 0;
    await g.act(op, { type: 'SET_VALVE', ...s.valve });
    const events = g.changes.flatMap((c) => c.events);
    expect(events.map((e) => e.type)).toEqual(['panel_solved', 'game_over']);
    expect(new Set(events.map((e) => e.version)).size).toBe(1);
    const room = await g.raw(g.roomId);
    expect(room.status).toBe('FINISHED');
    expect((await g.view(op)).kind).toBe('debrief');
  });
});

describe('Defuser timers (fake clock, section 11)', () => {
  it('auto-arms at 20 s, then detonates when the countdown reaches 0', async () => {
    const g = await started(3);
    await g.act(g.ids[0]!, { type: 'READY' });
    await vi.advanceTimersByTimeAsync(BRIEF - 1);
    expect((await g.game()).phase).toBe('BRIEFING');
    await vi.advanceTimersByTimeAsync(1);
    const armed = await g.game();
    expect(armed.phase).toBe('ARMED');
    expect(armed.deadlineAt).toBe(T0 + BRIEF + 270_000);
    await vi.advanceTimersByTimeAsync(270_000 - 1);
    expect((await g.game()).phase).toBe('ARMED');
    await vi.advanceTimersByTimeAsync(1);
    expect((await g.game()).result).toMatchObject({ outcome: 'detonated', reason: 'timer' });
    expect(g.finished).toHaveLength(1);
  });

  it('a solve arriving exactly at the deadline loses (GAME_FINISHED after DETONATED)', async () => {
    const g = await started(2);
    await g.armAll();
    const s = await g.game();
    const op = s.operatorId;
    const sol = solutionOf(SEED, 1);
    await g.act(op, { type: 'CUT_LINE', line: sol.fuse.line });
    await g.act(op, { type: 'PRESS_GLYPH', key: sol.glyph.first });
    await g.act(op, { type: 'PRESS_GLYPH', key: sol.glyph.second });
    vi.setSystemTime(s.deadlineAt!); // the timer hasn't fired yet: the action triggers it
    expect(await code(g.act(op, { type: 'SET_VALVE', ...sol.valve }))).toBe('GAME_FINISHED');
    expect((await g.game()).result).toMatchObject({ reason: 'timer', panelsSolved: 2 });
  });

  it('detonation deadline and a grace expiry in the same millisecond: the game deadline wins', async () => {
    const g = await started(3);
    await g.armAll();
    const s = await g.game();
    vi.setSystemTime(s.deadlineAt! - GRACE_MS);
    await g.manager.disconnect(g.ids[1]!, g.roomId);
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    const end = await g.game();
    expect(end.result).toMatchObject({ reason: 'timer' });
    // The drop-out never ran: the player is recorded as active at the end.
    expect(end.result!.individual[g.ids[1]!]).toBe('coop_loss');
  });
});

describe('Defuser disconnect, time-out, rejoin and Leave (section 14)', () => {
  it('a disconnect within grace changes nothing (scenario 1)', async () => {
    const g = await started(3);
    await g.armAll();
    const before = await g.view(g.ids[1]!);
    await g.manager.disconnect(g.ids[1]!, g.roomId);
    await vi.advanceTimersByTimeAsync(GRACE_MS - 1);
    await g.manager.connect(g.ids[1]!, g.roomId);
    const after = await g.view(g.ids[1]!);
    expect(after.kind).toBe(before.kind);
    expect((await g.game()).players.every((p) => p.status === 'active')).toBe(true);
  });

  it('Operator times out → promotion; reconnect shows Rejoin; REJOIN makes them an Analyst', async () => {
    const g = await started(3);
    await g.armAll();
    const op = await g.op();
    const [a] = await g.analysts();
    await g.manager.disconnect(op, g.roomId);
    g.changes.length = 0;
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    expect(g.changes.flatMap((c) => c.events).map((e) => e.type)).toEqual([
      'role_changed',
      'sheets_reassigned',
    ]);
    expect(await g.op()).toBe(a);
    expect((await g.raw(g.roomId)).seats.map((s) => s.userId)).toContain(op); // still seated
    await g.manager.connect(op, g.roomId);
    expect(await g.view(op)).toMatchObject({ kind: 'inactive', canRejoin: true });
    await g.act(op, { type: 'REJOIN' });
    expect(await g.view(op)).toMatchObject({ kind: 'analyst' });
  });

  it('a refused $ABANDON (already timed out) is saved without a version bump and never replays', async () => {
    const g = await started(3);
    await g.armAll();
    const [a] = await g.analysts();
    await g.manager.disconnect(a!, g.roomId);
    await vi.advanceTimersByTimeAsync(GRACE_MS); // times out
    await g.manager.connect(a!, g.roomId); // back, but doesn't rejoin
    await g.manager.disconnect(a!, g.roomId); // a new grace starts
    const room = await g.raw(g.roomId);
    expect(room.seats.find((s) => s.userId === a)!.graceDeadlineAt).not.toBeNull();
    const version = room.version;
    const gameVersion = (await g.game()).version;
    g.changes.length = 0;
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    const after = await g.raw(g.roomId);
    expect(after.version).toBe(version);
    expect((await g.game()).version).toBe(gameVersion);
    expect(g.changes).toEqual([]);
    expect(after.seats.find((s) => s.userId === a)!.graceDeadlineAt).toBeNull();
    // Nothing keeps firing (still well before the 4:30 countdown ends).
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    expect((await g.raw(g.roomId)).version).toBe(version);
    expect((await g.game()).phase).toBe('ARMED');
  });

  it('Leave in a 3-player game removes the seat and the game goes on (scenarios 5, 15)', async () => {
    const g = await started(3);
    await g.armAll();
    const [a, b] = (await g.analysts()) as [string, string];
    await g.manager.leave(a, g.roomId);
    const room = await g.raw(g.roomId);
    expect(room.status).toBe('IN_GAME');
    expect(room.seats.map((s) => s.userId)).not.toContain(a);
    expect((await g.game()).players.find((p) => p.id === a)!.status).toBe('left');
    expect(await code(g.act(a, { type: 'REJOIN' }))).toBe('NOT_ROOM_MEMBER');
    expect((await g.view(b)).kind).toBe('analyst');
  });

  it('a timed-out player who then leaves stays timed_out and loses their seat', async () => {
    const g = await started(4);
    await g.armAll();
    const [a] = (await g.analysts()) as [string];
    await g.manager.disconnect(a, g.roomId);
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    const v = (await g.raw(g.roomId)).version;
    await g.manager.leave(a, g.roomId);
    const room = await g.raw(g.roomId);
    expect(room.seats.map((s) => s.userId)).not.toContain(a);
    expect(room.version).toBe(v + 1); // only player_left: the $FORFEIT was refused
    expect((await g.game()).players.find((p) => p.id === a)!.status).toBe('timed_out');
  });

  it('2 players, one leaves → ABANDONED, the room returns to LOBBY (scenario 2)', async () => {
    const g = await started(2);
    await g.armAll();
    await g.manager.leave(g.ids[1]!, g.roomId);
    const room = await g.raw(g.roomId);
    expect(room.status).toBe('LOBBY');
    expect(g.finished[0]!.result).toMatchObject({ kind: 'coop', outcome: 'abandoned' });
  });
});

describe('Defuser match recording and rotation', () => {
  it('records roles, final status, rejoin, Operator inputs and the server-only generator info', async () => {
    const g = await started(3);
    await g.armAll();
    const op = await g.op();
    const [a, b] = (await g.analysts()) as [string, string];
    await g.manager.disconnect(op, g.roomId);
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    await g.manager.connect(op, g.roomId);
    await g.act(op, { type: 'REJOIN' });
    const s = solutionOf(SEED, 2);
    await g.act(a, { type: 'CUT_LINE', line: s.fuse.line });
    await g.act(a, { type: 'PRESS_GLYPH', key: s.glyph.first });
    await g.act(a, { type: 'PRESS_GLYPH', key: s.glyph.second });
    await g.act(a, { type: 'SET_VALVE', ...s.valve });
    const f = g.finished[0]!;
    expect(f.gameType).toBe('defuser');
    expect(f.generator).toEqual({ version: 1, seed: SEED });
    expect(f.result).toMatchObject({ kind: 'coop', outcome: 'defused', panelsSolved: 3 });
    const byId = Object.fromEntries(f.players.map((p) => [p.userId, p.coop]));
    expect(byId[op]).toEqual({
      startRole: 'operator',
      finalRole: 'analyst',
      letter: 'C',
      finalStatus: 'active',
      rejoined: true,
    });
    expect(byId[a]).toMatchObject({ startRole: 'analyst', finalRole: 'operator', letter: 'A' });
    expect(byId[b]).toMatchObject({ startRole: 'analyst', finalRole: 'analyst', letter: 'B' });
    const inputs = (f.moves as Array<{ kind: string }>).filter((m) => m.kind === 'input');
    expect(inputs).toHaveLength(4);
  });

  it('rotates the starting Operator A → B → C → A over rematches; promotions don’t change it', async () => {
    const g = await started(3);
    const order: string[] = [];
    for (let game = 0; game < 4; game++) {
      const s = await g.game();
      order.push(s.operatorId);
      await g.armAll();
      if (game === 1) {
        // A mid-game promotion: the starting Operator times out.
        await g.manager.disconnect(s.operatorId, g.roomId);
        await vi.advanceTimersByTimeAsync(GRACE_MS);
        await g.manager.connect(s.operatorId, g.roomId);
      }
      const op = (await g.game()).operatorId;
      for (let i = 0; i < 3; i++) {
        const st = await g.game();
        if (st.result) break;
        const line = [1, 2, 3, 4, 5].find(
          (l) => l !== st.edition.solution.fuse.line && !st.cutLines.includes(l),
        )!;
        await g.act(op, { type: 'CUT_LINE', line });
      }
      expect((await g.raw(g.roomId)).status).toBe('FINISHED');
      for (const id of g.ids) await g.manager.rematch(id, g.roomId, aid());
    }
    const seats = (await g.raw(g.roomId)).seats.map((s) => s.userId);
    const idx = order.map((id) => seats.indexOf(id));
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBe((idx[i - 1]! + 1) % 3);
  });
});

describe('Defuser races (section 22)', () => {
  it('a double-tap on two different lines: both are processed, in arrival order', async () => {
    const g = await started(2);
    await g.armAll();
    const op = await g.op();
    const right = solutionOf(SEED, 1).fuse.line;
    const wrong = [1, 2, 3, 4, 5].find((l) => l !== right)!;
    await Promise.all([
      g.act(op, { type: 'CUT_LINE', line: wrong }),
      g.act(op, { type: 'CUT_LINE', line: right }),
    ]);
    const s = await g.game();
    expect(s.faults).toBe(1);
    expect(s.solved.fuse).toBe(true);
  });

  it('the same line twice with different actionIds: the second is refused (line_cut or solved)', async () => {
    const g = await started(2);
    await g.armAll();
    const op = await g.op();
    const wrong = [1, 2, 3, 4, 5].find((l) => l !== solutionOf(SEED, 1).fuse.line)!;
    const results = await Promise.allSettled([
      g.act(op, { type: 'CUT_LINE', line: wrong }),
      g.act(op, { type: 'CUT_LINE', line: wrong }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((await g.game()).faults).toBe(1);
  });

  it('an Operator input in flight during a promotion is refused as inactive, not applied', async () => {
    const g = await started(3);
    await g.armAll();
    const op = await g.op();
    await g.manager.disconnect(op, g.roomId);
    vi.setSystemTime(Date.now() + GRACE_MS); // the grace expires as the input lands
    expect(await code(g.act(op, { type: 'CUT_LINE', line: 1 }))).toBe('INVALID_ACTION');
    const s = await g.game();
    expect(s.cutLines).toEqual([]);
    expect(s.operatorId).not.toBe(op);
  });
});

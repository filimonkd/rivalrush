import type { DefuserPlayerView, RoomEvent } from '@rivalrush/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createGameRegistry } from '../../src/games/registry.js';
import { SEED } from '../helpers/defuser.js';
import { startHarness, type DefuserHarness } from '../helpers/defuserHarness.js';
import { alice, makeManager } from '../helpers/manager.js';
import { aid } from '../helpers/manager.js';

/**
 * Defuser through the real server boundary (Express + Socket.IO + RoomManager + the registered
 * plug-in), with real sockets, a fixed seed and a controllable server clock. Everything here is
 * decided by the server; the test only sends intents. See test/helpers/defuserHarness.ts.
 */

let h: DefuserHarness;
afterEach(async () => {
  await h?.close();
});

const kinds = (h: DefuserHarness) => h.players.map((p) => p.view().kind);
const eventTypes = (events: RoomEvent[]) => events.map((e) => e.type);
const view = (h: DefuserHarness, i: number) => h.players[i]!.view();

describe('lifecycle over sockets: 2, 3 and 4 players', () => {
  it.each([
    [2, 6],
    [3, 3],
    [4, 2],
  ])('%i players: lobby, ready, start, play to DEFUSED, recorded', async (n, perAnalyst) => {
    h = await startHarness({ players: n });
    await h.startGame();
    // Exactly one Operator; everyone else is an Analyst; roster is public.
    expect(kinds(h).filter((k) => k === 'operator')).toHaveLength(1);
    expect(kinds(h).filter((k) => k === 'analyst')).toHaveLength(n - 1);
    const roster = view(h, 0).roster;
    expect(roster.map((r) => r.role).sort()).toEqual(
      ['operator', ...Array(n - 1).fill('analyst')].sort(),
    );
    expect(
      roster
        .filter((r) => r.role === 'analyst')
        .map((r) => r.letter)
        .sort(),
    ).toEqual(['A', 'B', 'C'].slice(0, n - 1));
    // Briefing: nobody has the Charge or sheet contents yet.
    for (const p of h.players) {
      const v = p.view();
      expect(v.phase).toBe('BRIEFING');
      if (v.kind === 'operator') expect(v.charge).toBeNull();
      if (v.kind === 'analyst') expect(v.sheets).toEqual([]);
    }
    await h.armAll();
    // Armed: the Operator has the Charge; each Analyst only their share of the six sheets.
    for (const p of h.players) {
      const v = p.view();
      expect(v.phase).toBe('ARMED');
      if (v.kind === 'operator') expect(v.charge).not.toBeNull();
      if (v.kind === 'analyst') expect(v.sheets).toHaveLength(perAnalyst);
    }
    await h.defuse();
    expect(kinds(h)).toEqual(Array(n).fill('debrief'));
    const room = h.operator().latest();
    expect(room.status).toBe('FINISHED');
    expect(room.game!.result).toMatchObject({
      kind: 'coop',
      outcome: 'defused',
      reason: 'defused',
      panelsSolved: 3,
      faults: 0,
    });
    expect(h.finished).toHaveLength(1);
    expect(h.finished[0]).toMatchObject({
      gameType: 'defuser',
      generator: { version: 1, seed: SEED },
    });
  });

  it('a Defuser room starts only when every guest is ready and the host starts it', async () => {
    h = await startHarness({ players: 3 });
    for (const p of h.players) await p.connect();
    const host = h.players[0]!;
    expect((await host.roomStart()).error?.code).toBe('NOT_READY');
    await h.players[1]!.roomReady();
    expect((await host.roomStart()).error?.code).toBe('NOT_READY');
    await h.players[2]!.roomReady();
    expect((await h.players[1]!.roomStart()).error?.code).toBe('NOT_HOST');
    expect((await host.roomStart()).ok).toBe(true);
  });

  it('a fifth player cannot join a 4-seat room', async () => {
    h = await startHarness({ players: 4 });
    await expect(
      h.server.rooms.joinByInvite(
        { userId: 'f'.repeat(24), displayName: 'E', photoUrl: null },
        h.inviteToken,
      ),
    ).rejects.toMatchObject({ code: 'ROOM_FULL' });
  });

  it('reconnect within the grace period restores the same role and sheets', async () => {
    h = await startHarness({ players: 3 });
    await h.startGame();
    await h.armAll();
    const [a] = h.analysts() as [(typeof h.players)[number]];
    const before = a.view();
    a.drop();
    await h.settle();
    expect(eventTypes(h.operator().events)).toContain('player_offline');
    await h.advance(30_000); // well inside the 60 s grace
    await a.connect();
    await h.settle();
    const after = a.view();
    expect(after.kind).toBe('analyst');
    expect(after.kind === 'analyst' && after.sheets).toEqual(
      before.kind === 'analyst' && before.sheets,
    );
    expect(eventTypes(h.operator().events)).toContain('player_online');
    // The roster still shows them active, in the same role.
    expect(after.roster.find((r) => r.userId === a.userId)).toMatchObject({
      role: 'analyst',
      status: 'active',
    });
    // The game goes on.
    await h.defuse();
    expect(h.operator().view().phase).toBe('DEFUSED');
  });

  it('resync over the socket and over REST returns the caller’s own view', async () => {
    h = await startHarness({ players: 3 });
    await h.startGame();
    await h.armAll();
    for (const p of h.players) {
      const r = await p.resync();
      const data = r.data as unknown as {
        changed: boolean;
        room?: { game: { view: DefuserPlayerView } };
      };
      expect(data.changed).toBe(true);
      expect(data.room!.game.view.kind).toBe(p.view().kind);
      expect(data.room!.game.view.me).toBe(p.userId);
      const rest = await p.get(`/api/rooms/${h.roomId}/state`);
      expect(rest.status).toBe(200);
      expect((rest.body as { room: { game: { view: DefuserPlayerView } } }).room.game.view.me).toBe(
        p.userId,
      );
    }
  });
});

describe('roles: Operator, rotation, promotion, redistribution, rejoin', () => {
  it('the first Operator is random: every seat gets the role over many starts', async () => {
    const counts = [0, 0, 0, 0];
    const registry = createGameRegistry({ defuserEnabled: true });
    for (let seed = 1; seed <= 200; seed++) {
      const ctx = makeManager(seed, registry.get);
      const room = await ctx.manager.createRoom(alice, 'defuser', {});
      const people = [
        alice,
        { userId: 'b'.repeat(24), displayName: 'B', photoUrl: null },
        { userId: 'c'.repeat(24), displayName: 'C', photoUrl: null },
        { userId: 'd'.repeat(24), displayName: 'D', photoUrl: null },
      ];
      for (const p of people.slice(1)) {
        await ctx.manager.joinByInvite(p, room.inviteToken);
        await ctx.manager.setReady(p.userId, room.roomId, true, aid());
      }
      await ctx.manager.start(alice.userId, room.roomId, aid());
      const state = (await ctx.raw(room.roomId)).game!.state as { operatorId: string };
      counts[people.findIndex((p) => p.userId === state.operatorId)]!++;
    }
    for (const c of counts) expect(c).toBeGreaterThan(25); // expected 50 each
  });

  it.each([2, 3, 4])(
    '%i players: rematch rotates the Operator in seat order, over five games',
    async (n) => {
      h = await startHarness({ players: n });
      await h.startGame();
      const ops: string[] = [];
      for (let game = 0; game < 5; game++) {
        await h.armAll();
        ops.push(h.operator().userId);
        await h.defuse();
        expect(h.operator().latest().status).toBe('FINISHED');
        for (const p of h.players) expect((await p.roomRematch()).ok).toBe(true);
        await h.settle();
        expect(h.players[0]!.view().phase).toBe('BRIEFING');
      }
      const seat = ops.map((id) => h.players.findIndex((p) => p.userId === id));
      for (let i = 1; i < seat.length; i++) expect(seat[i]).toBe((seat[i - 1]! + 1) % n);
      expect(eventTypes(h.players[0]!.events).filter((t) => t === 'rematch_started')).toHaveLength(
        5,
      );
    },
  );

  it('the Operator drops out: the earliest Analyst is promoted and receives the Charge; sheets move on', async () => {
    h = await startHarness({ players: 3 });
    await h.startGame();
    await h.armAll();
    const op = h.operator();
    const [a, b] = h.analysts() as [(typeof h.players)[number], (typeof h.players)[number]];
    op.drop();
    await h.settle();
    await h.advance(60_000); // the grace period ends: a time-out, not a Leave
    expect(a.view().kind).toBe('operator');
    const av = a.view();
    expect(av.kind === 'operator' && av.charge).not.toBeNull();
    const bv = b.view();
    expect(bv.kind === 'analyst' && bv.sheets).toHaveLength(6); // A's three moved to B
    expect(bv.version).toBe(av.version);
    const events = eventTypes(b.events);
    expect(events).toContain('role_changed');
    expect(events).toContain('sheets_reassigned');
    // The promoted player acts as Operator immediately; the old one cannot.
    const s = h.edition().solution;
    expect((await a.act({ type: 'CUT_LINE', line: s.fuse.line })).ok).toBe(true);
    await op.connect();
    await h.settle();
    expect(op.view()).toMatchObject({ kind: 'inactive', canRejoin: true });
    expect((await op.act({ type: 'CUT_LINE', line: 1 })).error?.details?.rule).toBe('inactive');
  });

  it('a returning player does not regain the Operator role: they rejoin as an Analyst', async () => {
    h = await startHarness({ players: 4 });
    await h.startGame();
    await h.armAll();
    const op = h.operator();
    op.drop();
    await h.settle();
    await h.advance(60_000);
    await op.connect();
    await h.settle();
    expect(op.view().kind).toBe('inactive');
    expect((await op.act({ type: 'REJOIN' })).ok).toBe(true);
    await h.settle();
    const v = op.view();
    expect(v.kind).toBe('analyst');
    expect(v.roster.find((r) => r.userId === op.userId)).toMatchObject({
      role: 'analyst',
      letter: 'D',
    });
    expect(h.roster().filter((r) => r.role === 'operator')).toHaveLength(1);
    expect(h.operator().userId).not.toBe(op.userId);
  });

  it('an Analyst drops out: their sheets are redistributed, and every sheet keeps an active holder', async () => {
    h = await startHarness({ players: 4 });
    await h.startGame();
    await h.armAll();
    const [a, b, c] = h.analysts() as [
      (typeof h.players)[number],
      (typeof h.players)[number],
      (typeof h.players)[number],
    ];
    b.drop();
    await h.settle();
    await h.advance(60_000);
    const av = a.view();
    const cv = c.view();
    expect(av.kind === 'analyst' && cv.kind === 'analyst').toBe(true);
    if (av.kind !== 'analyst' || cv.kind !== 'analyst') return;
    expect(av.sheets).toHaveLength(3);
    expect(cv.sheets).toHaveLength(3);
    expect(new Set([...av.sheets, ...cv.sheets].map((s) => s.id)).size).toBe(6);
    expect(
      h
        .operator()
        .view()
        .roster.find((r) => r.userId === b.userId),
    ).toMatchObject({
      role: null,
      status: 'timed_out',
    });
  });

  it('Leave and a disconnect time-out stay distinguishable (seat gone vs still seated)', async () => {
    h = await startHarness({ players: 4 });
    await h.startGame();
    await h.armAll();
    const [a, b] = h.analysts() as [(typeof h.players)[number], (typeof h.players)[number]];
    expect((await a.roomLeave()).ok).toBe(true); // an explicit Leave
    b.drop(); // a lost connection
    await h.settle();
    await h.advance(60_000); // the grace expires
    const seatsLeft = h
      .operator()
      .latest()
      .players.map((p) => p.userId);
    expect(seatsLeft).not.toContain(a.userId); // Leave removes the seat
    expect(seatsLeft).toContain(b.userId); // a time-out keeps it
    // Let the game end by the countdown and read what was recorded.
    await h.advance(300_000);
    const rec = h.finished[0]!;
    const byId = Object.fromEntries(rec.players.map((p) => [p.userId, p.coop!]));
    expect(byId[a.userId]!.finalStatus).toBe('left');
    expect(byId[b.userId]!.finalStatus).toBe('timed_out');
    expect(rec.result).toMatchObject({ kind: 'coop', outcome: 'detonated', reason: 'timer' });
    const result = rec.result as { individual: Record<string, string> };
    expect(result.individual[a.userId]).toBe('coop_dropped');
    expect(result.individual[b.userId]).toBe('coop_dropped');
    expect(result.individual[h.operator().userId]).toBe('coop_loss');
    expect(eventTypes(h.operator().events)).toContain('player_left');
  });

  it('with fewer than two players left the team result is ABANDONED', async () => {
    h = await startHarness({ players: 2 });
    await h.startGame();
    await h.armAll();
    const [a] = h.analysts() as [(typeof h.players)[number]];
    await a.roomLeave();
    await h.settle();
    expect(h.finished[0]!.result).toMatchObject({
      kind: 'coop',
      outcome: 'abandoned',
      reason: 'abandoned',
    });
  });

  it('room cleanup: when everyone has left the room is closed', async () => {
    h = await startHarness({ players: 3 });
    await h.startGame();
    await h.armAll();
    await h.defuse();
    for (const p of h.players) await p.roomLeave();
    await h.settle();
    const preview = await h.server.rooms.getInvitePreview(h.players[0]!.userId, h.inviteToken);
    expect(preview).toMatchObject({ status: 'CLOSED', joinable: false });
  });
});

describe('panel actions: intents in, the server decides', () => {
  const FUSE_WRONG = (h: DefuserHarness) => h.wrongLine();

  it('Fuse Lines: a wrong cut is a fault, repeating it is refused without a second fault, the right cut solves', async () => {
    h = await startHarness({ players: 2 });
    await h.startGame();
    await h.armAll();
    const op = h.operator();
    const wrong = FUSE_WRONG(h);
    expect((await op.act({ type: 'CUT_LINE', line: wrong })).ok).toBe(true);
    await h.settle();
    expect(op.view().faults).toBe(1);
    const dup = await op.act({ type: 'CUT_LINE', line: wrong });
    expect(dup.error).toMatchObject({ code: 'INVALID_ACTION', details: { rule: 'line_cut' } });
    expect(op.latestView().faults).toBe(1);
    expect((await op.act({ type: 'CUT_LINE', line: h.edition().solution.fuse.line })).ok).toBe(
      true,
    );
    await h.settle();
    expect(op.view().solved.fuse).toBe(true);
    expect(eventTypes(op.events).filter((t) => t === 'fault')).toHaveLength(1);
    expect(eventTypes(op.events)).toContain('panel_solved');
  });

  it('Glyph Ledger: first key lights, a wrong second key faults and clears, then the pair solves', async () => {
    h = await startHarness({ players: 2 });
    await h.startGame();
    await h.armAll();
    const op = h.operator();
    const { first, second } = h.edition().solution.glyph;
    const wrongSecond = [1, 2, 3, 4].find((k) => k !== first && k !== second)!;
    await op.act({ type: 'PRESS_GLYPH', key: first });
    await h.settle();
    const lit = op.view();
    expect(lit.kind === 'operator' && lit.litKey).toBe(first);
    expect((await op.act({ type: 'PRESS_GLYPH', key: first })).error?.details?.rule).toBe(
      'key_lit',
    );
    await op.act({ type: 'PRESS_GLYPH', key: wrongSecond });
    await h.settle();
    const cleared = op.view();
    expect(cleared.faults).toBe(1);
    expect(cleared.kind === 'operator' && cleared.litKey).toBeNull();
    await op.act({ type: 'PRESS_GLYPH', key: first });
    expect((await op.act({ type: 'PRESS_GLYPH', key: wrongSecond })).error?.details?.rule).toBe(
      'already_tried',
    );
    expect(op.latestView().faults).toBe(1);
    await op.act({ type: 'PRESS_GLYPH', key: second });
    await h.settle();
    expect(op.view().solved.glyph).toBe(true);
  });

  it('Coolant Valve: a wrong pair faults once and can never be committed twice', async () => {
    h = await startHarness({ players: 2 });
    await h.startGame();
    await h.armAll();
    const op = h.operator();
    const { level, vent } = h.edition().solution.valve;
    const wrong = { type: 'SET_VALVE', level, vent: vent === 'seal' ? 'vent' : 'seal' };
    expect((await op.act(wrong)).ok).toBe(true);
    expect((await op.act(wrong)).error).toMatchObject({ details: { rule: 'already_tried' } });
    await h.settle();
    expect(op.view().faults).toBe(1);
    expect((await op.act({ type: 'SET_VALVE', level, vent })).ok).toBe(true);
    await h.settle();
    expect(op.view().solved.valve).toBe(true);
  });

  it('the third new wrong input detonates at once; later input is GAME_FINISHED', async () => {
    h = await startHarness({ players: 3 });
    await h.startGame();
    await h.armAll();
    const op = h.operator();
    const s = h.edition().solution;
    await op.act({ type: 'CUT_LINE', line: h.wrongLine() });
    await op.act({ type: 'PRESS_GLYPH', key: [1, 2, 3, 4].find((k) => k !== s.glyph.first)! });
    await h.settle();
    expect(op.view().faults).toBe(2);
    await op.act({
      type: 'SET_VALVE',
      level: s.valve.level,
      vent: s.valve.vent === 'seal' ? 'vent' : 'seal',
    });
    await h.settle();
    const end = op.view();
    expect(end.kind).toBe('debrief');
    expect(end.result).toMatchObject({
      kind: 'coop',
      outcome: 'detonated',
      reason: 'faults',
      faults: 3,
    });
    expect((await op.act({ type: 'CUT_LINE', line: s.fuse.line })).error?.code).toBe(
      'GAME_FINISHED',
    );
    const over = op.events.filter((e) => e.type === 'game_over');
    expect(over).toHaveLength(1);
    expect(over[0]!.data).toEqual({ reason: 'faults' });
  });

  it('a retried action with the same actionId is applied once', async () => {
    h = await startHarness({ players: 2 });
    await h.startGame();
    await h.armAll();
    const op = h.operator();
    const wrong = h.wrongLine();
    expect((await op.act({ type: 'CUT_LINE', line: wrong }, 'retry_action_0001')).ok).toBe(true);
    expect((await op.act({ type: 'CUT_LINE', line: wrong }, 'retry_action_0001')).ok).toBe(true);
    await h.settle();
    expect(op.view().faults).toBe(1);
  });

  it('only the Operator can act; refusals are safe and never hint at the answer', async () => {
    h = await startHarness({ players: 3 });
    await h.startGame();
    const op = h.operator();
    const [a] = h.analysts() as [(typeof h.players)[number]];
    const s = h.edition().solution;
    // Briefing: device input → GAME_NOT_STARTED.
    expect((await op.act({ type: 'CUT_LINE', line: 1 })).error?.code).toBe('GAME_NOT_STARTED');
    await h.armAll();
    const refusals = [
      await a.act({ type: 'CUT_LINE', line: s.fuse.line }),
      await a.act({ type: 'PRESS_GLYPH', key: s.glyph.first }),
      await a.act({ type: 'SET_VALVE', ...s.valve }),
    ];
    for (const r of refusals) {
      expect(r.error).toMatchObject({ code: 'INVALID_ACTION', details: { rule: 'not_operator' } });
      expect(JSON.stringify(r.error)).not.toMatch(/solution|answer|correct/i);
    }
    expect((await op.act({ type: 'READY' })).error?.code).toBe('GAME_ALREADY_STARTED');
    for (const bad of [
      { type: 'CUT_LINE', line: 9 },
      { type: 'CUT_LINE', line: 1, playerId: a.userId },
      { type: 'SET_VALVE', level: 3, vent: 'open' },
      { type: 'FORFEIT' },
    ]) {
      const r = await op.act(bad);
      expect(r.error).toMatchObject({ code: 'INVALID_ACTION', message: 'Unknown move.' });
    }
    await h.settle();
    expect(op.view().faults).toBe(0); // nothing above changed the game
    expect(op.view().version).toBe(a.view().version);
  });
});

describe('timers: the server owns every deadline', () => {
  it('the briefing ends at 20 s on its own and the countdown starts then', async () => {
    h = await startHarness({ players: 3 });
    await h.startGame();
    await h.players[1]!.act({ type: 'READY' }); // not everyone is ready
    await h.settle();
    const brief = h.players[1]!.view();
    const t0 = brief.briefingDeadlineAt!;
    expect(brief.phase).toBe('BRIEFING');
    expect(brief.deadlineAt).toBeNull();
    await h.advance(t0 - h.now() - 1);
    expect(h.players[1]!.view().phase).toBe('BRIEFING');
    await h.advance(1);
    const armed = h.players[1]!.view();
    expect(armed.phase).toBe('ARMED');
    expect(armed.briefingDeadlineAt).toBeNull();
    expect(armed.deadlineAt).toBe(t0 + 270_000); // 4:00 + 0:30 for the second Analyst
    expect(eventTypes(h.players[2]!.events)).toContain('device_armed');
  });

  it.each([
    [2, 240_000],
    [3, 270_000],
    [4, 300_000],
  ])('%i players: the countdown is %i ms and detonates exactly at its end', async (n, ms) => {
    h = await startHarness({ players: n });
    await h.startGame();
    await h.armAll();
    const armedAt = h.now();
    const v = h.operator().view();
    expect(v.deadlineAt).toBe(armedAt + ms);
    await h.advance(ms - 1);
    expect(h.operator().view().phase).toBe('ARMED');
    await h.advance(1);
    const end = h.operator().view();
    expect(end.kind).toBe('debrief');
    expect(end.result).toMatchObject({ outcome: 'detonated', reason: 'timer', msRemaining: 0 });
    expect(
      h
        .operator()
        .events.filter((e) => e.type === 'game_over')
        .at(-1)!.data,
    ).toEqual({ reason: 'timer' });
  });

  it('exact deadline: a last solve arriving at the deadline loses to the timeout', async () => {
    h = await startHarness({ players: 2 });
    await h.startGame();
    await h.armAll();
    const op = h.operator();
    const s = h.edition().solution;
    await op.act({ type: 'CUT_LINE', line: s.fuse.line });
    await op.act({ type: 'PRESS_GLYPH', key: s.glyph.first });
    await op.act({ type: 'PRESS_GLYPH', key: s.glyph.second });
    const deadline = op.latestView().deadlineAt!;
    h.jump(deadline - h.now() - 1);
    // One millisecond before: the solve still counts.
    expect(h.now()).toBe(deadline - 1);
    h.jump(1); // now exactly at the deadline, and nothing has run the timer yet
    const late = await op.act({ type: 'SET_VALVE', ...s.valve });
    expect(late.error?.code).toBe('GAME_FINISHED');
    await h.settle();
    expect(op.view().result).toMatchObject({
      outcome: 'detonated',
      reason: 'timer',
      panelsSolved: 2,
    });
  });

  it('exact deadline: a solve one millisecond earlier wins', async () => {
    h = await startHarness({ players: 2 });
    await h.startGame();
    await h.armAll();
    const op = h.operator();
    const s = h.edition().solution;
    await op.act({ type: 'CUT_LINE', line: s.fuse.line });
    await op.act({ type: 'PRESS_GLYPH', key: s.glyph.first });
    await op.act({ type: 'PRESS_GLYPH', key: s.glyph.second });
    const deadline = op.latestView().deadlineAt!;
    h.jump(deadline - h.now() - 1);
    expect((await op.act({ type: 'SET_VALVE', ...s.valve })).ok).toBe(true);
    await h.settle();
    expect(op.view().result).toMatchObject({ outcome: 'defused', msRemaining: 1 });
  });

  it('a disconnect and reconnect never pauses or moves the countdown', async () => {
    h = await startHarness({ players: 3 });
    await h.startGame();
    await h.armAll();
    const [a] = h.analysts() as [(typeof h.players)[number]];
    const deadline = a.view().deadlineAt!;
    a.drop();
    await h.settle();
    await h.advance(40_000);
    await a.connect();
    await h.settle();
    expect(a.view().deadlineAt).toBe(deadline);
    expect(h.operator().view().deadlineAt).toBe(deadline);
    await h.advance(deadline - h.now() - 1);
    expect(h.operator().view().phase).toBe('ARMED');
    await h.advance(1);
    expect(h.operator().view().result).toMatchObject({ reason: 'timer' });
  });

  it('a time-out during the countdown does not change the deadline either', async () => {
    h = await startHarness({ players: 4 });
    await h.startGame();
    await h.armAll();
    const deadline = h.operator().view().deadlineAt!;
    h.analysts()[0]!.drop();
    await h.settle();
    await h.advance(60_000);
    expect(h.operator().view().deadlineAt).toBe(deadline);
    expect(h.operator().view().deadlineAt! - 300_000).toBeLessThan(h.now());
  });

  it('the grace period ends at 60 s and not before', async () => {
    h = await startHarness({ players: 3 });
    await h.startGame();
    await h.armAll();
    const [a] = h.analysts() as [(typeof h.players)[number]];
    a.drop();
    await h.settle();
    await h.advance(59_999);
    expect(
      h
        .operator()
        .view()
        .roster.find((r) => r.userId === a.userId)!.status,
    ).toBe('active');
    await h.advance(1);
    expect(
      h
        .operator()
        .view()
        .roster.find((r) => r.userId === a.userId)!.status,
    ).toBe('timed_out');
  });
});

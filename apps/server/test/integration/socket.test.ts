import type { RoomEvent, RoomSnapshot } from '@rivalrush/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MatchModel } from '../../src/matches/Match.model.js';
import { UserModel } from '../../src/users/User.model.js';
import {
  actionId,
  connected,
  emit,
  startTestServer,
  waitFor,
  type TestEnv,
} from '../helpers/integration.js';
import { duelView } from '../helpers/views.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestServer();
});
afterAll(async () => {
  await env?.stop();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function twoPlayersInRoom(idBase: number) {
  const a = await env.telegramLogin({ id: idBase, first_name: 'Ana' });
  const b = await env.telegramLogin({ id: idBase + 1, first_name: 'Ben' });
  const created = await env
    .http()
    .post('/api/rooms')
    .set(auth(a.token))
    .send({ gameType: 'crack-the-code', settings: { codeLength: 4 } })
    .expect(201);
  const room = created.body as RoomSnapshot;
  await env
    .http()
    .post('/api/rooms/join')
    .set(auth(b.token))
    .send({ inviteToken: room.inviteToken })
    .expect(200);
  const sa = env.connect(a.token);
  const sb = env.connect(b.token);
  await Promise.all([connected(sa), connected(sb)]);
  return { a, b, sa, sb, roomId: room.roomId };
}

describe('socket authentication and authorization', () => {
  it('rejects connections without a valid session token', async () => {
    const s = env.connect(null);
    await expect(connected(s)).rejects.toThrow(/UNAUTHORIZED/);
    const s2 = env.connect('forged.token.value');
    await expect(connected(s2)).rejects.toThrow(/UNAUTHORIZED/);
  });

  it('blocks non-members from subscribing or acting', async () => {
    const { roomId } = await twoPlayersInRoom(9000);
    const c = await env.telegramLogin({ id: 9010, first_name: 'Eve' });
    const sc = env.connect(c.token);
    await connected(sc);
    expect((await emit(sc, 'room:subscribe', { roomId })).error?.code).toBe('NOT_ROOM_MEMBER');
    expect(
      (
        await emit(sc, 'game:action', {
          roomId,
          actionId: actionId(),
          clientVersion: 1,
          action: { type: 'FORFEIT' },
        })
      ).error?.code,
    ).toBe('NOT_ROOM_MEMBER');
    expect((await emit(sc, 'room:subscribe', { roomId: 'x' })).error?.code).toBe(
      'VALIDATION_ERROR',
    );
  });
});

describe('a full Crack the Code match over Socket.IO', () => {
  it('plays create → ready → start → secrets → guesses → equalizer → result → rematch', async () => {
    const { a, sa, sb, roomId } = await twoPlayersInRoom(9100);
    const seenByA: RoomSnapshot[] = [];
    const seenByB: RoomSnapshot[] = [];
    const eventsB: RoomEvent[] = [];
    sa.on('room:snapshot', (s: RoomSnapshot) => seenByA.push(s));
    sb.on('room:snapshot', (s: RoomSnapshot) => seenByB.push(s));
    sb.on('room:event', (e: RoomEvent) => eventsB.push(e));

    expect((await emit<RoomSnapshot>(sa, 'room:subscribe', { roomId })).ok).toBe(true);
    expect((await emit<RoomSnapshot>(sb, 'room:subscribe', { roomId })).ok).toBe(true);

    const readyId = actionId();
    const ready = await emit<RoomSnapshot>(sb, 'room:ready', {
      roomId,
      ready: true,
      actionId: readyId,
    });
    expect(ready.data?.status).toBe('READY');
    const dupReady = await emit<RoomSnapshot>(sb, 'room:ready', {
      roomId,
      ready: true,
      actionId: readyId,
    });
    expect(dupReady.data?.version).toBe(ready.data?.version);

    expect((await emit(sb, 'room:start', { roomId, actionId: actionId() })).error?.code).toBe(
      'NOT_HOST',
    );
    const started = await emit<RoomSnapshot>(sa, 'room:start', { roomId, actionId: actionId() });
    expect(started.data?.status).toBe('IN_GAME');

    let gv = started.data!.game!.version;
    expect(
      (
        await emit(sa, 'game:action', {
          roomId,
          actionId: actionId(),
          clientVersion: gv,
          action: { type: 'SET_SECRET', code: '1123' },
        })
      ).error?.code,
    ).toBe('INVALID_SECRET');
    await emit(sa, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: gv,
      action: { type: 'SET_SECRET', code: '1234' },
    });
    const afterB = await emit<RoomSnapshot>(sb, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: gv,
      action: { type: 'SET_SECRET', code: '5678' },
    });
    const view = duelView(afterB.data!.game!.view);
    expect(view.phase).toBe('PLAYING');
    gv = afterB.data!.game!.version;

    const first =
      view.currentTurn === a.user.id
        ? { s: sa, other: sb, code: '5678' }
        : { s: sb, other: sa, code: '1234' };
    // Each player guesses the *other* player's code.
    const second = first.s === sa ? { s: sb, code: '1234' } : { s: sa, code: '5678' };

    expect(
      (
        await emit(first.other, 'game:action', {
          roomId,
          actionId: actionId(),
          clientVersion: gv,
          action: { type: 'GUESS', guess: '9012' },
        })
      ).error?.code,
    ).toBe('NOT_YOUR_TURN');

    const gId = actionId();
    const g1 = await emit<RoomSnapshot>(first.s, 'game:action', {
      roomId,
      actionId: gId,
      clientVersion: gv,
      action: { type: 'GUESS', guess: '9012' },
    });
    expect(g1.ok).toBe(true);
    const dup = await emit<RoomSnapshot>(first.s, 'game:action', {
      roomId,
      actionId: gId,
      clientVersion: gv,
      action: { type: 'GUESS', guess: '9012' },
    });
    expect(dup.ok).toBe(true);
    expect(duelView(dup.data!.game!.view).moves).toHaveLength(1);

    // A stale client gets STALE_GAME_VERSION plus the authoritative snapshot.
    const stale = await emit<RoomSnapshot>(second.s, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: gv,
      action: { type: 'GUESS', guess: '9012' },
    });
    expect(stale.error?.code).toBe('STALE_GAME_VERSION');
    expect(stale.snapshot?.game?.version).toBe(g1.data!.game!.version);
    gv = stale.snapshot!.game!.version;

    const g2 = await emit<RoomSnapshot>(second.s, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: gv,
      action: { type: 'GUESS', guess: '9012' },
    });
    gv = g2.data!.game!.version;
    const crack = await emit<RoomSnapshot>(first.s, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: gv,
      action: { type: 'GUESS', guess: first.code },
    });
    expect(duelView(crack.data!.game!.view).phase).toBe('LAST_CHANCE');
    gv = crack.data!.game!.version;
    const last = await emit<RoomSnapshot>(second.s, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: gv,
      action: { type: 'GUESS', guess: second.code },
    });
    expect(last.data!.status).toBe('FINISHED');
    expect(last.data!.game!.result).toEqual({
      outcome: 'draw',
      winnerId: null,
      reason: 'both_cracked',
    });
    expect(duelView(last.data!.game!.view).opponentSecret).toMatch(/^\d{4}$/);

    // Secrets: no snapshot either player received before the end reveals the opponent code.
    await new Promise((r) => setTimeout(r, 100));
    for (const [snaps, oppCode] of [
      [seenByA, '5678'],
      [seenByB, '1234'],
    ] as const) {
      for (const snap of snaps) {
        if (!snap.game || snap.game.result) continue;
        expect(duelView(snap.game.view).opponentSecret).toBeNull();
        const scrubbed = {
          ...snap,
          game: { ...snap.game, view: { ...duelView(snap.game.view), moves: [] } },
        };
        expect(JSON.stringify(scrubbed)).not.toContain(oppCode);
      }
    }
    expect(eventsB.map((e) => e.type)).toEqual(
      expect.arrayContaining(['game_started', 'guess_made', 'last_chance', 'game_over']),
    );

    // Stats are recorded (draw for both).
    await env.server.recorder.drain();
    const match = await MatchModel.findOne({ roomId }).lean();
    expect(match?.result?.reason).toBe('both_cracked');
    expect(JSON.stringify(match)).not.toMatch(/secret/i);
    const ua = await UserModel.findById(a.user.id).lean();
    expect(ua!.stats).toMatchObject({ gamesPlayed: 1, draws: 1 });

    // Rematch: both vote → a new session in the same room, other player first.
    const firstPlayerBefore = duelView(last.data!.game!.view).firstPlayerId;
    await emit(sa, 'room:rematch', { roomId, actionId: actionId() });
    const rm = await emit<RoomSnapshot>(sb, 'room:rematch', { roomId, actionId: actionId() });
    expect(rm.data!.status).toBe('IN_GAME');
    expect(rm.data!.game!.sessionId).not.toBe(last.data!.game!.sessionId);
    expect(duelView(rm.data!.game!.view).firstPlayerId).not.toBe(firstPlayerBefore);
    expect(rm.data!.gamesPlayed).toBe(1);

    // Secrets never appear in logs.
    const logs = env.logLines.join('');
    expect(logs).not.toContain('"1234"');
    expect(logs).not.toContain('"5678"');
    expect(logs).not.toContain('SET_SECRET');
  });
});

describe('reconnect and resync', () => {
  it('a dropped player sees "offline" to the opponent, then resumes with a fresh snapshot', async () => {
    const { a, b, sa, sb, roomId } = await twoPlayersInRoom(9200);
    await emit(sa, 'room:subscribe', { roomId });
    await emit(sb, 'room:subscribe', { roomId });
    await emit(sb, 'room:ready', { roomId, ready: true, actionId: actionId() });
    const started = await emit<RoomSnapshot>(sa, 'room:start', { roomId, actionId: actionId() });
    const v0 = started.data!.version;

    const offline = waitFor<RoomSnapshot>(sb, 'room:snapshot', (s) =>
      s.players.some((p) => p.userId === a.user.id && !p.online),
    );
    sa.disconnect();
    const seen = await offline;
    expect(seen.players.find((p) => p.userId === a.user.id)!.graceDeadlineAt).toBeGreaterThan(
      Date.now(),
    );

    // Meanwhile the opponent locks a secret; A's view is now behind.
    await emit(sb, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: 0,
      action: { type: 'SET_SECRET', code: '5678' },
    });

    // App reopened: REST tells it where to go, then the socket resyncs.
    const active = await env.http().get('/api/me/active-room').set(auth(a.token)).expect(200);
    expect(active.body.room.roomId).toBe(roomId);
    const sa2 = env.connect(a.token);
    await connected(sa2);
    const rs = await emit<{ changed: boolean; room?: RoomSnapshot }>(sa2, 'game:resync', {
      roomId,
      knownVersion: v0,
    });
    expect(rs.data!.changed).toBe(true);
    const back = rs.data!.room!;
    expect(back.players.find((p) => p.userId === a.user.id)).toMatchObject({
      online: true,
      graceDeadlineAt: null,
    });
    expect(duelView(back.game!.view).players.find((p) => p.userId === b.user.id)!.hasSecret).toBe(
      true,
    );
    expect(duelView(back.game!.view).opponentSecret).toBeNull();

    const same = await emit<{ changed: boolean }>(sa2, 'game:resync', {
      roomId,
      knownVersion: back.version,
    });
    expect(same.data).toEqual({ changed: false, version: back.version });

    // Leaving mid-game is a forfeit and closes the room for the leaver.
    const closed = waitFor<{ roomId: string; reason: string }>(sa2, 'room:closed');
    const left = await emit(sa2, 'room:leave', { roomId, actionId: actionId() });
    expect(left.ok).toBe(true);
    expect(await closed).toEqual({ roomId, reason: 'left' });
    const final = await env.http().get(`/api/rooms/${roomId}`).set(auth(b.token)).expect(200);
    expect(final.body.status).toBe('LOBBY');
  });

  it('throttles action spam', async () => {
    const { sa, roomId } = await twoPlayersInRoom(9300);
    const results = await Promise.all(
      Array.from({ length: 30 }, () => emit(sa, 'room:subscribe', { roomId })),
    );
    expect(results.some((r) => r.error?.code === 'RATE_LIMITED')).toBe(true);
  });
});

import type { RoomSnapshot } from '@rivalrush/shared';
import type { Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MatchModel } from '../../src/matches/Match.model.js';
import { recordMatch } from '../../src/matches/matchService.js';
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

/**
 * Reconnect/resync and stats over the real stack (HTTP + Socket.IO + MongoDB replica set).
 * The room clock can be moved forward (`skew`) to cross grace deadlines without waiting.
 */

let env: TestEnv;
let skew = 0;
beforeAll(async () => {
  env = await startTestServer({}, { now: () => Date.now() + skew });
});
afterAll(async () => {
  await env?.stop();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function duel(idBase: number) {
  const a = await env.telegramLogin({ id: idBase, first_name: 'Ada' });
  const b = await env.telegramLogin({ id: idBase + 1, first_name: 'Bo' });
  const created = await env
    .http()
    .post('/api/rooms')
    .set(auth(a.token))
    .send({ gameType: 'crack-the-code', settings: { codeLength: 4 } })
    .expect(201);
  const roomId = (created.body as RoomSnapshot).roomId;
  await env
    .http()
    .post('/api/rooms/join')
    .set(auth(b.token))
    .send({ inviteToken: (created.body as RoomSnapshot).inviteToken })
    .expect(200);
  const sa = env.connect(a.token);
  const sb = env.connect(b.token);
  await Promise.all([connected(sa), connected(sb)]);
  await emit(sa, 'room:subscribe', { roomId });
  await emit(sb, 'room:subscribe', { roomId });
  await emit(sb, 'room:ready', { roomId, ready: true, actionId: actionId() });
  await emit(sa, 'room:start', { roomId, actionId: actionId() });
  return { a, b, sa, sb, roomId };
}

/** Both lock secrets (A=1234, B=5678); returns sockets ordered by turn. */
async function lockIn(sa: Socket, sb: Socket, roomId: string, aId: string) {
  await emit(sa, 'game:action', {
    roomId,
    actionId: actionId(),
    clientVersion: 0,
    action: { type: 'SET_SECRET', code: '1234' },
  });
  const r = await emit<RoomSnapshot>(sb, 'game:action', {
    roomId,
    actionId: actionId(),
    clientVersion: 0,
    action: { type: 'SET_SECRET', code: '5678' },
  });
  const view = duelView(r.data!.game!.view);
  expect(view.phase).toBe('PLAYING');
  const aFirst = view.currentTurn === aId;
  return {
    version: r.data!.game!.version,
    first: aFirst ? sa : sb,
    second: aFirst ? sb : sa,
    firstCode: aFirst ? '5678' : '1234', // what the first player must guess
  };
}

describe('reconnect and resync over Socket.IO', () => {
  it('a duplicate action re-sent after reconnecting is applied once', async () => {
    const { a, b, sa, sb, roomId } = await duel(9400);
    const t = await lockIn(sa, sb, roomId, a.user.id);
    const id = actionId();
    const payload = {
      roomId,
      actionId: id,
      clientVersion: t.version,
      action: { type: 'GUESS', guess: '9012' },
    };
    const first = await emit<RoomSnapshot>(t.first, 'game:action', payload);
    expect(first.ok).toBe(true);

    // The reply was "lost": the client drops, reconnects on a new socket and retries.
    const firstToken = t.first === sa ? a.token : b.token;
    t.first.disconnect();
    const again = env.connect(firstToken);
    await connected(again);
    await emit(again, 'game:resync', { roomId });
    const retry = await emit<RoomSnapshot>(again, 'game:action', payload);
    expect(retry.ok).toBe(true);
    expect(duelView(retry.data!.game!.view).moves).toHaveLength(1);
    const state = await env.http().get(`/api/rooms/${roomId}`).set(auth(firstToken)).expect(200);
    expect(duelView((state.body as RoomSnapshot).game!.view).moves).toHaveLength(1);
  });

  it('a stale client after reconnecting is refused and handed the authoritative snapshot', async () => {
    const { a, b, sa, sb, roomId } = await duel(9410);
    const t = await lockIn(sa, sb, roomId, a.user.id);
    await emit(t.first, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: t.version,
      action: { type: 'GUESS', guess: '9012' },
    });
    // The second player was offline for that guess and comes back with an old board.
    const secondToken = t.second === sa ? a.token : b.token;
    t.second.disconnect();
    const back = env.connect(secondToken);
    await connected(back);
    const stale = await emit<RoomSnapshot>(back, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: t.version,
      action: { type: 'GUESS', guess: '9013' },
    });
    expect(stale.error?.code).toBe('STALE_GAME_VERSION');
    expect(duelView(stale.snapshot!.game!.view).moves).toHaveLength(1);
    expect(duelView(stale.snapshot!.game!.view).opponentSecret).toBeNull();
    // With the fresh version the same move goes through.
    const ok = await emit<RoomSnapshot>(back, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: stale.snapshot!.game!.version,
      action: { type: 'GUESS', guess: '9013' },
    });
    expect(ok.ok).toBe(true);
    expect(duelView(ok.data!.game!.view).moves).toHaveLength(2);
  });

  it('a game action arriving while a resync is in flight: both answered, newest state wins', async () => {
    const { a, sa, sb, roomId } = await duel(9420);
    const t = await lockIn(sa, sb, roomId, a.user.id);
    const [rs, act] = await Promise.all([
      emit<{ changed: boolean; room?: RoomSnapshot; version?: number }>(t.first, 'game:resync', {
        roomId,
        knownVersion: 0,
      }),
      emit<RoomSnapshot>(t.first, 'game:action', {
        roomId,
        actionId: actionId(),
        clientVersion: t.version,
        action: { type: 'GUESS', guess: '9012' },
      }),
    ]);
    expect(rs.ok).toBe(true);
    expect(act.ok).toBe(true);
    // The two are serialized by the room lock. A client keeps whichever has the higher
    // room version, which is always the state after the guess.
    const resyncVersion = rs.data!.room?.version ?? rs.data!.version!;
    const newest = Math.max(resyncVersion, act.data!.version);
    expect(newest).toBe(act.data!.version);
    expect(duelView(act.data!.game!.view).moves).toHaveLength(1);
  });

  it('subscribing to a room you are not in, or with a forged id, is refused', async () => {
    const { roomId } = await duel(9430);
    const c = await env.telegramLogin({ id: 9433, first_name: 'Cy' });
    const sc = env.connect(c.token);
    await connected(sc);
    expect((await emit(sc, 'game:resync', { roomId })).error?.code).toBe('NOT_ROOM_MEMBER');
    const peek = await env.http().get(`/api/rooms/${roomId}`).set(auth(c.token));
    expect(peek.status).toBe(403);
  });
});

describe('statistics stay consistent with match history', () => {
  it('forfeit → rematch → abandonment → rematch → leave: three records, stats match history', async () => {
    const { a, b, sa, sb, roomId } = await duel(9500);

    // Game 1: A gives up.
    await lockIn(sa, sb, roomId, a.user.id);
    await emit(sa, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: 0,
      action: { type: 'FORFEIT' },
    });

    // Game 2 (rematch): A drops and never returns within the grace period.
    await emit(sa, 'room:rematch', { roomId, actionId: actionId() });
    const rm = await emit<RoomSnapshot>(sb, 'room:rematch', { roomId, actionId: actionId() });
    expect(rm.data!.status).toBe('IN_GAME');
    const offline = waitFor<RoomSnapshot>(sb, 'room:snapshot', (s) =>
      s.players.some((p) => p.userId === a.user.id && !p.online),
    );
    sa.disconnect();
    await offline;
    skew += 61_000; // the grace period passes
    const late = await emit<RoomSnapshot>(sb, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: 0,
      action: { type: 'SET_SECRET', code: '5678' },
    });
    expect(late.error?.code).toBe('GAME_FINISHED');
    expect(late.snapshot!.game!.result).toEqual({
      outcome: 'win',
      winnerId: b.user.id,
      reason: 'abandoned',
    });

    // A reopens the app and asks for another rematch; B accepts.
    const sa2 = env.connect(a.token);
    await connected(sa2);
    await emit(sa2, 'game:resync', { roomId });
    await emit(sa2, 'room:rematch', { roomId, actionId: actionId() });
    await emit(sb, 'room:rematch', { roomId, actionId: actionId() });

    // Game 3: B leaves mid-game, which is a forfeit (A wins).
    await lockIn(sa2, sb, roomId, a.user.id);
    await emit(sb, 'room:leave', { roomId, actionId: actionId() });

    await env.server.recorder.drain();
    const matches = await MatchModel.find({ roomId }).sort({ endedAt: 1 }).lean();
    expect(matches.map((m) => m.result?.reason)).toEqual(['forfeit', 'abandoned', 'forfeit']);
    expect(matches.map((m) => m.isRematch)).toEqual([false, true, true]);
    expect(new Set(matches.map((m) => m.sessionId)).size).toBe(3);
    expect(JSON.stringify(matches)).not.toMatch(/"1234"|"5678"|secret/i);

    // Stats equal the aggregate of the user's match history.
    for (const user of [a.user, b.user]) {
      const doc = await UserModel.findById(user.id).lean();
      const mine = await MatchModel.find({ 'players.userId': user.id }).lean();
      const outcomes = mine.map(
        (m) => m.players.find((p) => String(p.userId) === user.id)!.outcome,
      );
      expect(doc!.stats).toMatchObject({
        gamesPlayed: mine.length,
        wins: outcomes.filter((o) => o === 'win').length,
        losses: outcomes.filter((o) => o === 'loss').length,
        draws: outcomes.filter((o) => o === 'draw').length,
      });
    }
    // A: loss, loss, win → streak 1. B: win, win, loss → streak 0, best 2.
    const statsA = await env.http().get('/api/me/stats').set(auth(a.token)).expect(200);
    expect(statsA.body).toMatchObject({
      stats: { gamesPlayed: 3, wins: 1, losses: 2, draws: 0, currentStreak: 1, bestStreak: 1 },
      winRate: 33.3,
    });
    const profileB = await env
      .http()
      .get(`/api/profile/${b.user.id}`)
      .set(auth(a.token))
      .expect(200);
    expect(profileB.body.user.stats).toMatchObject({
      wins: 2,
      losses: 1,
      currentStreak: 0,
      bestStreak: 2,
    });
    expect(profileB.body.recentMatches.map((m: { reason: string }) => m.reason)).toEqual([
      'forfeit',
      'abandoned',
      'forfeit',
    ]);
    const history = await env.http().get('/api/me/matches').set(auth(a.token)).expect(200);
    expect(history.body.matches.map((m: { outcome: string }) => m.outcome)).toEqual([
      'win',
      'loss',
      'loss',
    ]);

    // Repeated completion of an already-recorded session changes nothing.
    const m0 = matches[0]!;
    const replay = {
      sessionId: m0.sessionId,
      roomId,
      gameType: m0.gameType,
      settings: m0.settings as Record<string, unknown>,
      isRematch: false,
      players: m0.players.map((p) => ({
        userId: String(p.userId),
        displayName: p.displayName,
        photoUrl: null,
      })),
      result: {
        outcome: 'win' as const,
        winnerId: m0.result?.winnerId ?? null,
        reason: 'forfeit' as const,
      },
      moves: [],
      startedAt: m0.startedAt.getTime(),
      endedAt: m0.endedAt.getTime(),
    };
    const replays = await Promise.all([recordMatch(replay), recordMatch(replay)]);
    expect(replays).toEqual(['duplicate', 'duplicate']);
    const after = await env.http().get('/api/me/stats').set(auth(a.token)).expect(200);
    expect(after.body.stats).toEqual(statsA.body.stats);
  });

  it('clients have no way to write stats or results', async () => {
    const a = await env.telegramLogin({ id: 9600, first_name: 'Eve' });
    for (const path of ['/api/me/stats', '/api/me/matches', `/api/profile/${a.user.id}`]) {
      const r = await env
        .http()
        .post(path)
        .set(auth(a.token))
        .send({ stats: { wins: 999 } });
      expect(r.status).toBe(404);
    }
    const me = await env.http().get('/api/me').set(auth(a.token)).expect(200);
    expect(me.body.stats.wins).toBe(0);
  });
});

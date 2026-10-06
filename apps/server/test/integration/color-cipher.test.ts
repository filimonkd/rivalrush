import type { RoomSnapshot } from '@rivalrush/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MatchModel } from '../../src/matches/Match.model.js';
import { UserModel } from '../../src/users/User.model.js';
import {
  actionId,
  connected,
  emit,
  startTestServer,
  type TestEnv,
} from '../helpers/integration.js';
import { duelView } from '../helpers/views.js';

/** Color Cipher over the real stack: REST + Socket.IO + MongoDB, using only existing endpoints. */

let env: TestEnv;
beforeAll(async () => {
  env = await startTestServer();
});
afterAll(async () => {
  await env?.stop();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const A_PATTERN = '0034';
const B_PATTERN = '2241';

async function ccRoom(idBase: number) {
  const a = await env.telegramLogin({ id: idBase, first_name: 'Abebe' });
  const b = await env.telegramLogin({ id: idBase + 1, first_name: 'Bethel' });
  const created = await env
    .http()
    .post('/api/rooms')
    .set(auth(a.token))
    .send({ gameType: 'color-cipher', settings: { turnSeconds: 45, maxGuesses: 10 } })
    .expect(201);
  const room = created.body as RoomSnapshot;
  const preview = await env
    .http()
    .get(`/api/rooms/invite/${room.inviteToken}`)
    .set(auth(b.token))
    .expect(200);
  expect(preview.body).toMatchObject({
    gameType: 'color-cipher',
    host: { displayName: 'Abebe' },
    joinable: true,
  });
  await env
    .http()
    .post('/api/rooms/join')
    .set(auth(b.token))
    .send({ inviteToken: room.inviteToken })
    .expect(200);
  const sa = env.connect(a.token);
  const sb = env.connect(b.token);
  await Promise.all([connected(sa), connected(sb)]);
  await emit(sa, 'room:subscribe', { roomId: room.roomId });
  await emit(sb, 'room:subscribe', { roomId: room.roomId });
  await emit(sb, 'room:ready', { roomId: room.roomId, ready: true, actionId: actionId() });
  const started = await emit<RoomSnapshot>(sa, 'room:start', {
    roomId: room.roomId,
    actionId: actionId(),
  });
  expect(started.data!.status).toBe('IN_GAME');
  return { a, b, sa, sb, roomId: room.roomId };
}

describe('Color Cipher over Socket.IO', () => {
  it('a full match: patterns, guesses, last chance, draw, recorded with stats', async () => {
    const { a, b, sa, sb, roomId } = await ccRoom(9700);
    const seenByA: RoomSnapshot[] = [];
    const seenByB: RoomSnapshot[] = [];
    sa.on('room:snapshot', (s: RoomSnapshot) => seenByA.push(s));
    sb.on('room:snapshot', (s: RoomSnapshot) => seenByB.push(s));

    expect(
      (
        await emit(sa, 'game:action', {
          roomId,
          actionId: actionId(),
          clientVersion: 0,
          action: { type: 'SET_SECRET', pattern: '0129' },
        })
      ).error?.code,
    ).toBe('INVALID_SECRET');
    await emit(sa, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: 0,
      action: { type: 'SET_SECRET', pattern: A_PATTERN },
    });
    const afterB = await emit<RoomSnapshot>(sb, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: 0,
      action: { type: 'SET_SECRET', pattern: B_PATTERN },
    });
    const view = duelView(afterB.data!.game!.view);
    expect(view.gameId).toBe('color-cipher');
    expect(view.phase).toBe('PLAYING');
    let gv = afterB.data!.game!.version;

    const aFirst = view.currentTurn === a.user.id;
    const first = aFirst ? sa : sb;
    const second = aFirst ? sb : sa;
    const firstTarget = aFirst ? B_PATTERN : A_PATTERN;
    const secondTarget = aFirst ? A_PATTERN : B_PATTERN;

    // The client cannot send feedback or a result along with its guess.
    const forged = await emit(first, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: gv,
      action: { type: 'GUESS', pattern: '5555', exact: 4, winnerId: a.user.id },
    });
    expect(forged.error?.code).toBe('INVALID_ACTION');

    const g1 = await emit<RoomSnapshot>(first, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: gv,
      action: { type: 'GUESS', pattern: '5555' },
    });
    expect(duelView(g1.data!.game!.view).moves.at(-1)).toMatchObject({ exact: 0, partial: 0 });
    gv = g1.data!.game!.version;

    // Stale client → refused with the authoritative snapshot.
    const stale = await emit<RoomSnapshot>(second, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: gv - 1,
      action: { type: 'GUESS', pattern: '5555' },
    });
    expect(stale.error?.code).toBe('STALE_GAME_VERSION');
    expect(stale.snapshot!.game!.version).toBe(gv);

    const g2 = await emit<RoomSnapshot>(second, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: gv,
      action: { type: 'GUESS', pattern: '5555' },
    });
    gv = g2.data!.game!.version;
    const crack = await emit<RoomSnapshot>(first, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: gv,
      action: { type: 'GUESS', pattern: firstTarget },
    });
    expect(duelView(crack.data!.game!.view).phase).toBe('LAST_CHANCE');
    gv = crack.data!.game!.version;
    const last = await emit<RoomSnapshot>(second, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: gv,
      action: { type: 'GUESS', pattern: secondTarget },
    });
    expect(last.data!.game!.result).toEqual({
      outcome: 'draw',
      winnerId: null,
      reason: 'both_cracked',
    });
    expect(duelView(last.data!.game!.view).opponentSecret).toMatch(/^[0-5]{4}$/);

    // No pushed snapshot revealed an opponent pattern before the end.
    await new Promise((r) => setTimeout(r, 100));
    for (const [snaps, opp] of [
      [seenByA, B_PATTERN],
      [seenByB, A_PATTERN],
    ] as const) {
      for (const snap of snaps) {
        if (!snap.game || snap.game.result) continue;
        expect(duelView(snap.game.view).opponentSecret).toBeNull();
        const scrubbed = {
          ...snap,
          game: { ...snap.game, view: { ...duelView(snap.game.view), moves: [] } },
        };
        expect(JSON.stringify(scrubbed)).not.toContain(opp);
      }
    }

    await env.server.recorder.drain();
    const match = await MatchModel.findOne({ roomId }).lean();
    expect(match).toMatchObject({ gameType: 'color-cipher', result: { reason: 'both_cracked' } });
    expect(match!.moves[0]).toMatchObject({ guess: '5555', exact: 0, partial: 0 });
    expect(match!.moves[0]).not.toHaveProperty('bulls');
    expect(JSON.stringify(match)).not.toMatch(/secret/i);
    const ua = await UserModel.findById(a.user.id).lean();
    const ub = await UserModel.findById(b.user.id).lean();
    expect(ua!.stats).toMatchObject({ gamesPlayed: 1, draws: 1 });
    expect(ub!.stats).toMatchObject({ gamesPlayed: 1, draws: 1 });

    // History says which game it was.
    const hist = await env.http().get('/api/me/matches').set(auth(a.token)).expect(200);
    expect(hist.body.matches[0]).toMatchObject({
      gameType: 'color-cipher',
      outcome: 'draw',
      reason: 'both_cracked',
    });

    // Rematch through the shared room flow: same game, other player first.
    await emit(sa, 'room:rematch', { roomId, actionId: actionId() });
    const rm = await emit<RoomSnapshot>(sb, 'room:rematch', { roomId, actionId: actionId() });
    expect(rm.data!.gameType).toBe('color-cipher');
    expect(duelView(rm.data!.game!.view).phase).toBe('SETUP');
    expect(duelView(rm.data!.game!.view).firstPlayerId).not.toBe(view.firstPlayerId);

    // Patterns never reach the logs.
    const logs = env.logLines.join('');
    expect(logs).not.toContain(`"${A_PATTERN}"`);
    expect(logs).not.toContain(`"${B_PATTERN}"`);
  });

  it('the opponent pattern cannot be read through the API while playing', async () => {
    const { a, b, sa, sb, roomId } = await ccRoom(9710);
    await emit(sa, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: 0,
      action: { type: 'SET_SECRET', pattern: A_PATTERN },
    });
    await emit(sb, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: 0,
      action: { type: 'SET_SECRET', pattern: B_PATTERN },
    });
    for (const [token, mine, theirs] of [
      [a.token, A_PATTERN, B_PATTERN],
      [b.token, B_PATTERN, A_PATTERN],
    ] as const) {
      for (const path of [
        `/api/rooms/${roomId}`,
        `/api/rooms/${roomId}/state`,
        '/api/me/active-room',
      ]) {
        const r = await env.http().get(path).set(auth(token)).expect(200);
        const body = JSON.stringify(r.body);
        expect(body).toContain(mine);
        expect(body).not.toContain(theirs);
      }
    }
  });

  it('reconnect: a new socket resyncs to the authoritative Color Cipher state', async () => {
    const { a, sa, sb, roomId } = await ccRoom(9720);
    await emit(sa, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: 0,
      action: { type: 'SET_SECRET', pattern: A_PATTERN },
    });
    sa.disconnect();
    await emit(sb, 'game:action', {
      roomId,
      actionId: actionId(),
      clientVersion: 0,
      action: { type: 'SET_SECRET', pattern: B_PATTERN },
    });
    const sa2 = env.connect(a.token);
    await connected(sa2);
    const rs = await emit<{ changed: boolean; room: RoomSnapshot }>(sa2, 'game:resync', {
      roomId,
      knownVersion: 0,
    });
    expect(rs.data!.changed).toBe(true);
    const view = duelView(rs.data!.room.game!.view);
    expect(view).toMatchObject({ gameId: 'color-cipher', phase: 'PLAYING', mySecret: A_PATTERN });
    expect(view.opponentSecret).toBeNull();
    expect(rs.data!.room.players.find((p) => p.userId === a.user.id)).toMatchObject({
      online: true,
      graceDeadlineAt: null,
    });
  });
});

describe('both games share history and stats', () => {
  it('old Crack the Code records stay valid next to Color Cipher records', async () => {
    const legacy = await MatchModel.create({
      sessionId: 'legacy-ctc-1',
      roomId: 'legacyroom01',
      gameType: 'crack-the-code',
      settings: { codeLength: 4, turnSeconds: 45, maxGuesses: 10 },
      players: [],
      result: { outcome: 'draw', winnerId: null, reason: 'out_of_guesses' },
      moves: [
        {
          playerId: 'x',
          guess: '1234',
          bulls: 1,
          cows: 2,
          timedOut: false,
          turnNumber: 1,
          at: new Date(),
        },
      ],
      startedAt: new Date(),
      endedAt: new Date(),
    });
    const back = await MatchModel.findById(legacy._id).lean();
    expect(back!.moves[0]).toMatchObject({ guess: '1234', bulls: 1, cows: 2 });
    expect(back!.moves[0]).not.toHaveProperty('exact');
  });
});

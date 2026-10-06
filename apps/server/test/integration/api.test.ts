import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signInitData } from '../../src/auth/telegramAuth.js';
import { recordMatch, type FinishedSession } from '../../src/matches/matchService.js';
import { MatchModel } from '../../src/matches/Match.model.js';
import { RoomModel } from '../../src/rooms/Room.model.js';
import { UserModel } from '../../src/users/User.model.js';
import { BOT_TOKEN, startTestServer, type TestEnv } from '../helpers/integration.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestServer();
});
afterAll(async () => {
  await env?.stop();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('health', () => {
  it('reports ok without leaking infrastructure details', async () => {
    const res = await env.http().get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
    expect(Object.keys(res.body).sort()).toEqual([
      'database',
      'status',
      'uptimeSeconds',
      'version',
    ]);
    await env.http().get('/health').expect(200);
  });
});

describe('POST /api/auth/telegram', () => {
  it('signs in with valid launch data, upserts the user and issues a session', async () => {
    const a = await env.telegramLogin({ id: 1001, first_name: 'Abebe', username: 'abebe' });
    expect(a.user).toMatchObject({
      displayName: 'Abebe',
      username: 'abebe',
      stats: { gamesPlayed: 0 },
    });
    expect(a.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    const again = await env.telegramLogin({ id: 1001, first_name: 'Abebe K.', username: 'abebe' });
    expect(again.user.id).toBe(a.user.id);
    expect(again.user.displayName).toBe('Abebe K.');
    expect(await UserModel.countDocuments({ telegramId: 1001 })).toBe(1);
  });

  it('records invite-driven acquisition and returns the invite token', async () => {
    const r = await env.telegramLogin(
      { id: 1002, first_name: 'Invitee' },
      { start_param: 'room_Ab3dEf7Hj9Kl2Mn4' },
    );
    expect(r.inviteToken).toBe('Ab3dEf7Hj9Kl2Mn4');
    const doc = await UserModel.findById(r.user.id).lean();
    expect(doc?.acquisition?.viaInvite).toBe(true);
  });

  it('rejects tampered, foreign-bot, stale and malformed launch data', async () => {
    const now = Math.floor(Date.now() / 1000);
    const good = { user: JSON.stringify({ id: 5, first_name: 'X' }), auth_date: String(now) };
    const tampered = signInitData(good, BOT_TOKEN).replace('X', 'Y');
    const foreign = signInitData(good, '1:OTHER');
    const stale = signInitData({ ...good, auth_date: String(now - 7200) }, BOT_TOKEN);
    const future = signInitData({ ...good, auth_date: String(now + 3600) }, BOT_TOKEN);
    expect(
      (await env.http().post('/api/auth/telegram').send({ initData: tampered }).expect(401)).body
        .error.code,
    ).toBe('INVALID_TELEGRAM_AUTH');
    expect(
      (await env.http().post('/api/auth/telegram').send({ initData: foreign }).expect(401)).body
        .error.code,
    ).toBe('INVALID_TELEGRAM_AUTH');
    expect(
      (await env.http().post('/api/auth/telegram').send({ initData: stale }).expect(401)).body.error
        .code,
    ).toBe('STALE_AUTH');
    expect(
      (await env.http().post('/api/auth/telegram').send({ initData: future }).expect(401)).body
        .error.code,
    ).toBe('STALE_AUTH');
    expect((await env.http().post('/api/auth/telegram').send({}).expect(400)).body.error.code).toBe(
      'VALIDATION_ERROR',
    );
    expect(
      (
        await env
          .http()
          .post('/api/auth/telegram')
          .send({ initData: 'x', userId: 'admin' })
          .expect(400)
      ).body.error.code,
    ).toBe('VALIDATION_ERROR');
  });

  it('never logs raw launch data', async () => {
    await env.telegramLogin({ id: 1003, first_name: 'Logcheck' });
    expect(env.logLines.join('')).not.toContain('auth_date=');
    expect(env.logLines.join('')).not.toContain(BOT_TOKEN);
  });
});

describe('authenticated REST', () => {
  it('requires a valid session token', async () => {
    expect((await env.http().get('/api/me').expect(401)).body.error.code).toBe('UNAUTHORIZED');
    await env.http().get('/api/me').set(auth('not.a.jwt')).expect(401);
    await env.http().get('/api/rooms/abcdefgh1234').expect(401);
  });

  it('serves /me, /me/stats, /games', async () => {
    const a = await env.telegramLogin({ id: 2001, first_name: 'Meera' });
    const me = await env.http().get('/api/me').set(auth(a.token)).expect(200);
    expect(me.body.displayName).toBe('Meera');
    const stats = await env.http().get('/api/me/stats').set(auth(a.token)).expect(200);
    expect(stats.body).toEqual({
      stats: {
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        currentStreak: 0,
        bestStreak: 0,
        coop: { played: 0, wins: 0, losses: 0, dropped: 0 },
      },
      winRate: 0,
    });
    const games = await env.http().get('/api/games').set(auth(a.token)).expect(200);
    const statusOf = (id: string) =>
      games.body.games.find((g: { id: string }) => g.id === id).status;
    expect(statusOf('crack-the-code')).toBe('live');
    expect(statusOf('color-cipher')).toBe('live');
    expect(statusOf('defuser')).toBe('coming_soon');
    expect(
      games.body.games.filter((g: { status: string }) => g.status === 'coming_soon').length,
    ).toBeGreaterThan(0);
  });

  it('room flow over REST: create → preview → join → state → start → leave', async () => {
    const host = await env.telegramLogin({ id: 3001, first_name: 'Host' });
    const guest = await env.telegramLogin({ id: 3002, first_name: 'Guest' });
    const outsider = await env.telegramLogin({ id: 3003, first_name: 'Outsider' });

    const created = await env
      .http()
      .post('/api/rooms')
      .set(auth(host.token))
      .send({ gameType: 'crack-the-code', settings: { codeLength: 3 } })
      .expect(201);
    const { roomId, inviteToken } = created.body;
    expect(created.body.settings.codeLength).toBe(3);

    const preview = await env
      .http()
      .get(`/api/rooms/invite/${inviteToken}`)
      .set(auth(guest.token))
      .expect(200);
    expect(preview.body).toMatchObject({
      joinable: true,
      host: { displayName: 'Host' },
      roomId: null,
      seatsTaken: 1,
    });

    expect(
      (await env.http().get(`/api/rooms/${roomId}`).set(auth(outsider.token)).expect(403)).body
        .error.code,
    ).toBe('NOT_ROOM_MEMBER');

    const joined = await env
      .http()
      .post('/api/rooms/join')
      .set(auth(guest.token))
      .send({ inviteToken })
      .expect(200);
    expect(joined.body.players).toHaveLength(2);
    expect(
      (
        await env
          .http()
          .post('/api/rooms/join')
          .set(auth(outsider.token))
          .send({ inviteToken })
          .expect(409)
      ).body.error.code,
    ).toBe('ROOM_FULL');

    const state = await env
      .http()
      .get(`/api/rooms/${roomId}/state?knownVersion=${joined.body.version}`)
      .set(auth(host.token))
      .expect(200);
    expect(state.body).toEqual({ changed: false, version: joined.body.version });
    const stale = await env
      .http()
      .get(`/api/rooms/${roomId}/state?knownVersion=1`)
      .set(auth(host.token))
      .expect(200);
    expect(stale.body.changed).toBe(true);

    expect(
      (
        await env
          .http()
          .post(`/api/rooms/${roomId}/start`)
          .set(auth(guest.token))
          .send({})
          .expect(403)
      ).body.error.code,
    ).toBe('NOT_HOST');
    expect(
      (
        await env
          .http()
          .post(`/api/rooms/${roomId}/start`)
          .set(auth(host.token))
          .send({})
          .expect(409)
      ).body.error.code,
    ).toBe('NOT_READY');

    const active = await env.http().get('/api/me/active-room').set(auth(guest.token)).expect(200);
    expect(active.body.room.roomId).toBe(roomId);

    await env.http().post(`/api/rooms/${roomId}/leave`).set(auth(host.token)).send({}).expect(200);
    const after = await env.http().get(`/api/rooms/${roomId}`).set(auth(guest.token)).expect(200);
    expect(after.body.hostId).toBe(guest.user.id);

    // Room metadata is persisted with a hashed invite token only.
    await env.server.roomRepo.drain();
    const doc = await RoomModel.findOne({ roomId }).lean();
    expect(doc?.peakPlayers).toBe(2);
    expect(JSON.stringify(doc)).not.toContain(inviteToken);
  });

  it('old invite links to a room that is gone explain themselves', async () => {
    const host = await env.telegramLogin({ id: 3101, first_name: 'Solo' });
    const created = await env
      .http()
      .post('/api/rooms')
      .set(auth(host.token))
      .send({ gameType: 'crack-the-code' })
      .expect(201);
    await env
      .http()
      .post(`/api/rooms/${created.body.roomId}/leave`)
      .set(auth(host.token))
      .send({})
      .expect(200);
    const res = await env
      .http()
      .get(`/api/rooms/invite/${created.body.inviteToken}`)
      .set(auth(host.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ joinable: false, reason: 'ROOM_CLOSED' });
    expect(
      (
        await env
          .http()
          .get('/api/rooms/invite/NoSuchToken0000000')
          .set(auth(host.token))
          .expect(404)
      ).body.error.code,
    ).toBe('ROOM_NOT_FOUND');
    expect(
      (await env.http().get('/api/rooms/invite/bad!').set(auth(host.token)).expect(404)).body.error
        .code,
    ).toBe('ROOM_NOT_FOUND');
  });

  it('validates input and limits request size', async () => {
    const a = await env.telegramLogin({ id: 4001, first_name: 'Val' });
    expect(
      (
        await env
          .http()
          .post('/api/rooms')
          .set(auth(a.token))
          .send({ gameType: 'crack-the-code', settings: { codeLength: 9 } })
          .expect(400)
      ).body.error.code,
    ).toBe('VALIDATION_ERROR');
    expect(
      (
        await env
          .http()
          .post('/api/rooms')
          .set(auth(a.token))
          .send({ gameType: 'defuser' })
          .expect(400)
      ).body.error.code,
    ).toBe('GAME_NOT_AVAILABLE');
    await env
      .http()
      .post('/api/rooms')
      .set(auth(a.token))
      .set('Content-Type', 'application/json')
      .send('{"gameType": ')
      .expect(400);
    await env
      .http()
      .post('/api/rooms')
      .set(auth(a.token))
      .send({ gameType: 'x'.repeat(20_000) })
      .expect(413);
  });

  it('sets security headers and restricts CORS to configured origins', async () => {
    const res = await env.http().get('/api/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const evil = await env.http().get('/api/health').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('dev login exists only when enabled', async () => {
    const r = await env.http().post('/api/auth/dev').send({ name: 'Alice' }).expect(200);
    expect(r.body.user.displayName).toBe('Alice');
    const doc = await UserModel.findById(r.body.user.id).lean();
    expect(doc!.telegramId).toBeLessThan(0);
  });
});

describe('match recording', () => {
  async function session(
    a: string,
    b: string,
    over: Partial<FinishedSession> = {},
  ): Promise<FinishedSession> {
    return {
      sessionId: `s-${Math.random().toString(36).slice(2)}`,
      roomId: 'room12345678',
      gameType: 'crack-the-code',
      settings: { codeLength: 4, turnSeconds: 45, maxGuesses: 10 },
      isRematch: false,
      players: [
        { userId: a, displayName: 'A', photoUrl: null },
        { userId: b, displayName: 'B', photoUrl: null },
      ],
      result: { outcome: 'win', winnerId: a, reason: 'cracked' },
      moves: [
        {
          playerId: a,
          guess: '1234',
          bulls: 4,
          cows: 0,
          timedOut: false,
          at: Date.now(),
          turnNumber: 1,
        },
      ],
      startedAt: Date.now() - 60_000,
      endedAt: Date.now(),
      ...over,
    };
  }

  it('records once per session id and updates W/L/D and streaks atomically', async () => {
    const a = (await env.telegramLogin({ id: 5001, first_name: 'Winner' })).user.id;
    const b = (await env.telegramLogin({ id: 5002, first_name: 'Loser' })).user.id;
    const s1 = await session(a, b);
    expect(await recordMatch(s1)).toBe('recorded');
    expect(await recordMatch(s1)).toBe('duplicate');
    await Promise.all([recordMatch(s1), recordMatch(s1)]);
    expect(await MatchModel.countDocuments({ sessionId: s1.sessionId })).toBe(1);

    await recordMatch(await session(a, b));
    let ua = await UserModel.findById(a).lean();
    expect(ua!.stats).toMatchObject({ gamesPlayed: 2, wins: 2, currentStreak: 2, bestStreak: 2 });

    await recordMatch(
      await session(a, b, { result: { outcome: 'draw', winnerId: null, reason: 'both_cracked' } }),
    );
    await recordMatch(
      await session(a, b, { result: { outcome: 'win', winnerId: b, reason: 'forfeit' } }),
    );
    ua = await UserModel.findById(a).lean();
    const ub = await UserModel.findById(b).lean();
    expect(ua!.stats).toMatchObject({
      gamesPlayed: 4,
      wins: 2,
      draws: 1,
      losses: 1,
      currentStreak: 0,
      bestStreak: 2,
    });
    expect(ub!.stats).toMatchObject({
      gamesPlayed: 4,
      wins: 1,
      draws: 1,
      losses: 2,
      currentStreak: 1,
      bestStreak: 1,
    });
  });

  it('profile shows stats, win rate and recent matches without secrets', async () => {
    const a = await env.telegramLogin({ id: 5101, first_name: 'Pro' });
    const b = await env.telegramLogin({ id: 5102, first_name: 'File' });
    await recordMatch(await session(a.user.id, b.user.id));
    const p = await env.http().get(`/api/profile/${a.user.id}`).set(auth(b.token)).expect(200);
    expect(p.body.winRate).toBe(100);
    expect(p.body.recentMatches[0]).toMatchObject({
      outcome: 'win',
      reason: 'cracked',
      opponent: { displayName: 'B' },
    });
    const mine = await env.http().get('/api/me/matches').set(auth(b.token)).expect(200);
    expect(mine.body.matches[0].outcome).toBe('loss');
    expect(JSON.stringify(p.body)).not.toMatch(/secret/i);
    await env.http().get('/api/profile/not-an-id').set(auth(a.token)).expect(404);
  });
});

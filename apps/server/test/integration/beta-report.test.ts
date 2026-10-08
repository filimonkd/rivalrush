import { Types } from 'mongoose';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GameStartModel } from '../../src/analytics/GameStart.model.js';
import { computeBetaReport } from '../../src/analytics/betaReport.js';
import { parseDay, parseTesters } from '../../src/analytics/betaReportFormat.js';
import { MatchModel } from '../../src/matches/Match.model.js';
import { RoomModel } from '../../src/rooms/Room.model.js';
import { UserModel } from '../../src/users/User.model.js';
import { aid } from '../helpers/manager.js';
import { startTestServer, type TestEnv } from '../helpers/integration.js';

/**
 * The beta metrics against a real MongoDB: a hand-built week whose every number is known, the
 * game-start record a real game writes, and proof that computing the report writes nothing.
 */
let env: TestEnv;
beforeAll(async () => {
  env = await startTestServer();
});
afterAll(async () => {
  await env?.stop();
});

const at = (iso: string) => new Date(iso);
const ids = { u1: new Types.ObjectId(), u2: new Types.ObjectId(), u3: new Types.ObjectId() };
const u4 = new Types.ObjectId();
const u5 = new Types.ObjectId();

async function seedWeek() {
  const user = (_id: Types.ObjectId, telegramId: number, username: string, created: string) => ({
    _id,
    telegramId,
    username,
    firstName: username,
    displayName: username,
    createdAt: at(created),
  });
  await UserModel.insertMany([
    { ...user(ids.u1, 101, 'ana', '2026-10-12T08:00:00Z'), acquisition: { viaInvite: true } },
    { ...user(ids.u2, 102, 'Bee', '2026-10-12T08:05:00Z'), acquisition: { viaInvite: true } },
    user(ids.u3, 103, 'cy', '2026-10-13T09:00:00Z'),
    user(u4, 104, 'dee', '2026-10-19T09:00:00Z'),
    user(u5, 105, 'old', '2026-10-01T09:00:00Z'),
    { ...user(new Types.ObjectId(), -1, 'dev', '2026-10-12T09:00:00Z'), isDev: true },
  ]);
  const room = (roomId: string, created: string, peakPlayers: number) => ({
    roomId,
    inviteTokenHash: `hash-${roomId}`,
    gameType: 'crack-the-code',
    settings: {},
    hostId: String(ids.u1),
    peakPlayers,
    status: 'CLOSED',
    expiresAt: at('2026-11-01T00:00:00Z'),
    purgeAt: at('2026-12-01T00:00:00Z'),
    createdAt: at(created),
  });
  await RoomModel.insertMany([
    room('r0', '2026-10-11T10:00:00Z', 2),
    room('r1', '2026-10-12T10:00:00Z', 2),
    room('r2', '2026-10-12T11:00:00Z', 1),
    room('r3', '2026-10-13T10:00:00Z', 3),
  ]);
  const start = (sessionId: string, when: string, isRematch = false) => ({
    sessionId,
    roomId: 'r1',
    gameType: 'crack-the-code',
    isRematch,
    players: 2,
    startedAt: at(when),
  });
  await GameStartModel.insertMany([
    start('s0', '2026-10-11T10:05:00Z'),
    start('s1', '2026-10-12T10:05:00Z'),
    start('s2', '2026-10-12T10:20:00Z', true),
    start('s3', '2026-10-13T10:05:00Z'),
    // Started, never recorded: lost to a restart.
    start('s4', '2026-10-13T11:00:00Z'),
  ]);
  const match = (
    sessionId: string,
    ended: string,
    reason: string,
    players: Types.ObjectId[],
    extra: { isRematch?: boolean; gameType?: string } = {},
  ) => ({
    sessionId,
    roomId: 'r1',
    gameType: extra.gameType ?? 'crack-the-code',
    settings: {},
    isRematch: extra.isRematch ?? false,
    players: players.map((userId) => ({ userId, displayName: 'x', outcome: 'draw', turns: 1 })),
    result: {
      outcome: reason === 'abandoned' ? 'abandoned' : 'win',
      winnerId: null,
      reason,
    },
    startedAt: at(ended),
    endedAt: at(ended),
  });
  await MatchModel.insertMany([
    match('s0', '2026-10-11T10:15:00Z', 'cracked', [ids.u1, u5]),
    match('s1', '2026-10-12T10:15:00Z', 'cracked', [ids.u1, ids.u2]),
    match('s2', '2026-10-12T10:30:00Z', 'forfeit', [ids.u1, ids.u2], { isRematch: true }),
    match('s3', '2026-10-13T10:30:00Z', 'abandoned', [ids.u1, ids.u3], {
      gameType: 'color-cipher',
    }),
    match('s5', '2026-10-19T12:00:00Z', 'cracked', [ids.u2, u4]),
  ]);
}

describe('beta report', () => {
  it('computes every metric for a known week', async () => {
    await seedWeek();
    const window = {
      since: parseDay('2026-10-12', 'UTC'),
      until: parseDay('2026-10-20', 'UTC'),
      timeZone: 'UTC',
    };
    const r = await computeBetaReport(window, parseTesters('101\n@bee\n'));

    expect(r.rooms).toEqual({ created: 3, joined: 2 });
    expect(r.starts).toEqual({
      started: 4,
      unfinished: 1,
      trackedSince: '2026-10-11T10:05:00.000Z',
    });
    expect(r.matches).toMatchObject({
      total: 4,
      normal: 2,
      forfeit: 1,
      abandoned: 1,
      rematches: 1,
      byReason: { cracked: 2, forfeit: 1, abandoned: 1 },
      byGame: [
        { gameType: 'color-cipher', matches: 1, rematches: 0, abandoned: 1 },
        { gameType: 'crack-the-code', matches: 3, rematches: 1, abandoned: 0 },
      ],
    });
    // u1 and u2: 3 games on 2 days each; u3 and u4: one game.
    expect(r.players).toEqual({ players: 4, totalGames: 8, threePlusGames: 2, multiDay: 2 });
    // Only u2 started in the window 7+ days before its end, and came back on day 7.
    expect(r.daySeven).toEqual({ eligible: 1, returned: 1 });
    expect(r.users).toEqual({ newUsers: 4, viaInvite: 2 });
    // ana (by id) and Bee (by @username, any case) are testers; cy and dee are not.
    expect(r.outsiders).toBe(2);
    expect(r.daily).toEqual([
      {
        day: '2026-10-12',
        rooms: 2,
        joined: 1,
        started: 2,
        matches: 2,
        normal: 1,
        abandoned: 0,
        rematches: 1,
        players: 2,
      },
      {
        day: '2026-10-13',
        rooms: 1,
        joined: 1,
        started: 2,
        matches: 1,
        normal: 0,
        abandoned: 1,
        rematches: 0,
        players: 2,
      },
      {
        day: '2026-10-19',
        rooms: 0,
        joined: 0,
        started: 0,
        matches: 1,
        normal: 1,
        abandoned: 0,
        rematches: 0,
        players: 2,
      },
    ]);
    // No names leave the report.
    expect(JSON.stringify(r)).not.toMatch(/ana|Bee|"cy"|dee/);
  });

  it('buckets days, and the window, in the requested time zone', async () => {
    // Kiritimati is UTC+14: the 10:05 UTC starts fall after midnight of the next local day.
    const tz = 'Pacific/Kiritimati';
    const r = await computeBetaReport({
      since: parseDay('2026-10-12', tz),
      until: parseDay('2026-10-20', tz),
      timeZone: tz,
    });
    // s0 (11 Oct 10:05 UTC = 12 Oct 00:05 local) is now inside the window.
    expect(r.daily.map((d) => [d.day, d.started])).toEqual([
      ['2026-10-12', 1],
      ['2026-10-13', 2],
      ['2026-10-14', 2],
    ]);
    expect(r.starts.started).toBe(5);
    // The window ends at 20 Oct 00:00 local = 19 Oct 10:00 UTC, before s5 ended.
    expect(r.matches.total).toBe(4);
  });

  it('writes nothing', async () => {
    const db = mongoose.connection.db!;
    const snapshot = async () => {
      const names = (await db.listCollections().toArray()).map((c) => c.name).sort();
      const counts = await Promise.all(names.map((n) => db.collection(n).countDocuments()));
      return { names, counts };
    };
    const before = await snapshot();
    await computeBetaReport(
      { since: at('2026-10-01T00:00:00Z'), until: at('2026-11-01T00:00:00Z'), timeZone: 'UTC' },
      parseTesters('1'),
    );
    expect(await snapshot()).toEqual(before);
  });

  it('a real game start is stored, once, with metadata only', async () => {
    const rooms = env.server.rooms;
    const host = { userId: String(new Types.ObjectId()), displayName: 'Host', photoUrl: null };
    const guest = { userId: String(new Types.ObjectId()), displayName: 'Guest', photoUrl: null };
    const created = await rooms.createRoom(host, 'crack-the-code', {});
    await rooms.joinByInvite(guest, created.inviteToken);
    await rooms.setReady(guest.userId, created.roomId, true, aid());
    await rooms.connect(host.userId, created.roomId);
    await rooms.connect(guest.userId, created.roomId);
    const startId = aid();
    const snap = await rooms.start(host.userId, created.roomId, startId);
    await rooms.start(host.userId, created.roomId, startId);
    expect(snap.status).toBe('IN_GAME');

    let docs: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 50 && docs.length === 0; i++) {
      docs = await GameStartModel.find({ roomId: created.roomId }, { _id: 0, __v: 0 }).lean();
      if (docs.length === 0) await new Promise((r) => setTimeout(r, 20));
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      roomId: created.roomId,
      gameType: 'crack-the-code',
      isRematch: false,
      players: 2,
    });
    expect(Object.keys(docs[0]!).sort()).toEqual(
      ['gameType', 'isRematch', 'players', 'roomId', 'sessionId', 'startedAt'].sort(),
    );
    await rooms.leave(host.userId, created.roomId);
  });
});

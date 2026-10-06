import type { RoomSnapshot } from '@rivalrush/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MatchModel } from '../../src/matches/Match.model.js';
import { UserModel } from '../../src/users/User.model.js';
import { SEED } from '../helpers/defuser.js';
import { DefuserHarness } from '../helpers/defuserHarness.js';
import { startTestServer, type TestEnv } from '../helpers/integration.js';
import { historyLeaksIn, leaksIn } from '../helpers/leak.js';

/**
 * Defuser end to end against a real MongoDB replica set, real users and REST room creation:
 * a full match over real sockets with a fixed seed, then stats, history and profile through the
 * REST API. Runs in CI (and anywhere MongoDB is available); the harness variant that needs no
 * database is test/unit/defuser-backend*.test.ts.
 */

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('gating: Defuser is off unless explicitly enabled', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startTestServer();
  });
  afterAll(async () => {
    await env?.stop();
  });

  it('by default nobody can create a Defuser room, and the catalog does not offer it', async () => {
    const u = await env.telegramLogin({ id: 9490, first_name: 'Plain' });
    const created = await env
      .http()
      .post('/api/rooms')
      .set(auth(u.token))
      .send({ gameType: 'defuser', settings: {} });
    expect(created.status).toBeGreaterThanOrEqual(400);
    expect(created.body.error.code).toBe('GAME_NOT_AVAILABLE');
    const games = await env.http().get('/api/games').set(auth(u.token)).expect(200);
    expect(games.body.games.find((g: { id: string }) => g.id === 'defuser').status).toBe(
      'coming_soon',
    );
    expect(games.body.games.filter((g: { status: string }) => g.status === 'live')).toHaveLength(2);
  });

  it('production refuses to start with Defuser enabled or a fixed seed', async () => {
    const { loadConfig } = await import('../../src/config/env.js');
    const prod = {
      NODE_ENV: 'production',
      BOT_TOKEN: '123:abc',
      JWT_SECRET: 'x'.repeat(40),
      MONGODB_URI: 'mongodb+srv://example/db',
      CLIENT_ORIGINS: 'https://rivalrush.vercel.app',
    };
    expect(() => loadConfig({ ...prod, DEFUSER_ENABLED: 'true' })).toThrow(/DEFUSER_ENABLED/);
    expect(() => loadConfig({ ...prod, DEFUSER_FIXED_SEED: SEED })).toThrow(/DEFUSER_FIXED_SEED/);
  });
});

describe('a full Defuser match with real users, stats and history', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startTestServer({ DEFUSER_ENABLED: 'true', DEFUSER_FIXED_SEED: SEED });
  });
  afterAll(async () => {
    await env?.stop();
  });

  it('plays two games (a defuse, then a detonation) and records them as co-op results only', async () => {
    const users = await Promise.all(
      [9501, 9502, 9503].map((id, i) =>
        env.telegramLogin({ id, first_name: ['Ana', 'Ben', 'Cy'][i]! }),
      ),
    );
    // REST: create and join (needs real users; the DB-free harness skips this part).
    const created = await env
      .http()
      .post('/api/rooms')
      .set(auth(users[0]!.token))
      .send({ gameType: 'defuser', settings: {} })
      .expect(201);
    const room = created.body as RoomSnapshot;
    expect(room).toMatchObject({ gameType: 'defuser', maxPlayers: 4 });
    for (const u of users.slice(1)) {
      await env
        .http()
        .post('/api/rooms/join')
        .set(auth(u.token))
        .send({ inviteToken: room.inviteToken })
        .expect(200);
    }

    const h = DefuserHarness.attach({
      server: env.server,
      config: env.config,
      url: env.url,
      roomId: room.roomId,
      inviteToken: room.inviteToken,
      seed: SEED,
      players: users.map((u) => ({ userId: u.user.id, name: u.user.displayName })),
    });
    try {
      await h.startGame();
      await h.armAll();
      // Game 1: one fault, then all three panels.
      await h.operator().act({ type: 'CUT_LINE', line: h.wrongLine() });
      await h.defuse();
      expect(h.operator().latestView().result).toMatchObject({ outcome: 'defused', faults: 1 });

      // Game 2 (rematch): three faults detonate.
      for (const p of h.players) await p.roomRematch();
      await h.settle();
      await h.armAll();
      const s = h.edition().solution;
      const op = h.operator();
      await op.act({ type: 'CUT_LINE', line: h.wrongLine() });
      await op.act({ type: 'PRESS_GLYPH', key: [1, 2, 3, 4].find((k) => k !== s.glyph.first)! });
      await op.act({
        type: 'SET_VALVE',
        level: s.valve.level,
        vent: s.valve.vent === 'seal' ? 'vent' : 'seal',
      });
      await h.settle();
      expect(op.latestView().result).toMatchObject({ outcome: 'detonated', reason: 'faults' });
      await env.server.recorder.drain();

      // Stats: only the co-op block moved; the duel counters and streak stayed at zero.
      for (const u of users) {
        const doc = await UserModel.findById(u.user.id).lean();
        expect(doc!.stats).toMatchObject({
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          currentStreak: 0,
          bestStreak: 0,
          coop: { played: 2, wins: 1, losses: 1, dropped: 0 },
        });
        const me = await env.http().get('/api/me/stats').set(auth(u.token)).expect(200);
        expect(me.body.stats.coop).toEqual({ played: 2, wins: 1, losses: 1, dropped: 0 });
        expect(me.body.stats.gamesPlayed).toBe(0);
      }

      // History: newest first; roles, teammates, result fields; nothing hidden.
      const edition = h.edition();
      const roles = new Map<string, string>();
      for (const u of users) {
        const res = await env.http().get('/api/me/matches').set(auth(u.token)).expect(200);
        expect(historyLeaksIn(res.body, edition)).toEqual([]);
        const [lost, won] = res.body.matches;
        expect(res.body.matches).toHaveLength(2);
        expect(won).toMatchObject({
          gameType: 'defuser',
          outcome: 'coop_win',
          reason: 'defused',
          opponent: null,
          coop: { panelsSolved: 3, faults: 1 },
        });
        expect(lost).toMatchObject({
          outcome: 'coop_loss',
          reason: 'faults',
          opponent: null,
          coop: { panelsSolved: 0, faults: 3, msRemaining: expect.any(Number) },
        });
        expect(won.teammates).toHaveLength(2);
        expect(won.turns).toBe(5); // 1 wrong cut + 4 solving inputs
        roles.set(`${u.user.id}:win`, won.coop.role);
        const profile = await env
          .http()
          .get(`/api/profile/${u.user.id}`)
          .set(auth(users[0]!.token))
          .expect(200);
        expect(historyLeaksIn(profile.body, edition)).toEqual([]);
        expect(JSON.stringify(profile.body)).not.toContain(SEED);
      }
      // Exactly one Operator per game.
      expect([...roles.values()].filter((r) => r === 'operator')).toHaveLength(1);

      // The stored match keeps the seed server-side only.
      const stored = await MatchModel.find({ gameType: 'defuser' }).select('+generator').lean();
      expect(stored).toHaveLength(2);
      for (const m of stored) expect(m.generator).toEqual({ version: 1, seed: SEED });
      expect(await MatchModel.findOne({ gameType: 'defuser' }).lean()).not.toHaveProperty(
        'generator',
      );

      // Every payload the three players received, over every channel, is clean.
      const problems: string[] = [];
      for (const p of h.players) {
        for (const list of [p.snapshots, p.acks, p.rest]) {
          list.forEach((payload, i) =>
            problems.push(...leaksIn(payload, edition, `${p.name}[${i}]`)),
          );
        }
      }
      expect(problems).toEqual([]);
      // Logs: the seed never appears.
      expect(env.logLines.join('')).not.toContain(SEED);
    } finally {
      for (const s of h.sockets) s.disconnect();
    }
  });
});

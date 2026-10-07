import { issueSession } from '../../src/auth/jwt.js';
import { loadConfig } from '../../src/config/env.js';
import { generateEdition } from '../../src/games/defuser/edition.js';
import { createGameRegistry, getGame, listGames } from '../../src/games/registry.js';
import { createLogger } from '../../src/logger.js';
import { buildServer } from '../../src/server.js';
import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryRoomStore } from '../../src/rooms/InMemoryRoomStore.js';
import { RoomManager } from '../../src/rooms/roomManager.js';
import request from 'supertest';
import { SEED } from '../helpers/defuser.js';
import { alice, bob, makeManager } from '../helpers/manager.js';
import { code } from '../helpers/scenarios.js';
import type { DefuserState } from '../../src/games/defuser/state.js';

const OTHER_SEED = 'fedcba9876543210fedcba9876543210';

describe('game registry: Defuser registration and gating', () => {
  it('the production-safe default registers only the duels', () => {
    expect(getGame('crack-the-code')?.id).toBe('crack-the-code');
    expect(getGame('color-cipher')?.id).toBe('color-cipher');
    expect(getGame('defuser')).toBeNull();
    expect(createGameRegistry().get('defuser')).toBeNull();
    expect(createGameRegistry({ defuserEnabled: false }).get('defuser')).toBeNull();
  });

  it('enabled: Defuser is a GameDefinition for 2–4 players, next to the unchanged duels', () => {
    const r = createGameRegistry({ defuserEnabled: true });
    const d = r.get('defuser')!;
    expect(d).toMatchObject({ id: 'defuser', name: 'Defuser', minPlayers: 2, maxPlayers: 4 });
    for (const fn of [
      'parseSettings',
      'parseAction',
      'createInitialState',
      'applyAction',
      'getPlayerView',
      'getPublicView',
      'getResult',
      'getVersion',
      'getNextDeadline',
      'getMoves',
    ] as const) {
      expect(typeof d[fn]).toBe('function');
    }
    expect(r.get('crack-the-code')).toBe(getGame('crack-the-code'));
    expect(r.get('color-cipher')).toBe(getGame('color-cipher'));
  });

  it('is never advertised: the catalog entry stays coming_soon whether or not it is registered', () => {
    for (const r of [createGameRegistry(), createGameRegistry({ defuserEnabled: true })]) {
      expect(r.list().find((g) => g.id === 'defuser')).toMatchObject({
        status: 'coming_soon',
        minPlayers: 2,
        maxPlayers: 4,
      });
      expect(
        r
          .list()
          .filter((g) => g.status === 'live')
          .map((g) => g.id),
      ).toEqual(['crack-the-code', 'color-cipher']);
    }
    expect(listGames().find((g) => g.id === 'defuser')!.status).toBe('coming_soon');
  });

  it('refuses to register Defuser, or a fixed seed, in production', () => {
    expect(() => createGameRegistry({ isProduction: true, defuserEnabled: true })).toThrow(
      /not available in production/,
    );
    expect(() => createGameRegistry({ isProduction: true, defuserFixedSeed: SEED })).toThrow(
      /not available in production/,
    );
    expect(() => createGameRegistry({ isProduction: true })).not.toThrow();
  });

  it('staging (production-hardened) may register Defuser, listed as preview; never a fixed seed', () => {
    const r = createGameRegistry({ isProduction: true, isStaging: true, defuserEnabled: true });
    expect(r.get('defuser')?.id).toBe('defuser');
    expect(r.list().map((g) => [g.id, g.status])).toEqual([
      ['crack-the-code', 'live'],
      ['color-cipher', 'live'],
      ['defuser', 'preview'],
    ]);
    expect(() =>
      createGameRegistry({ isProduction: true, isStaging: true, defuserFixedSeed: SEED }),
    ).toThrow(/not available in production/);
    // Staging without the flag: nothing registered, nothing previewed.
    const off = createGameRegistry({ isProduction: true, isStaging: true });
    expect(off.get('defuser')).toBeNull();
    expect(off.list().find((g) => g.id === 'defuser')!.status).toBe('coming_soon');
    // isStaging means nothing outside production: dev/test stays coming_soon.
    const dev = createGameRegistry({ isStaging: true, defuserEnabled: true });
    expect(dev.list().find((g) => g.id === 'defuser')!.status).toBe('coming_soon');
  });

  it('lookups cannot reach inherited properties', () => {
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '']) {
      expect(createGameRegistry({ defuserEnabled: true }).get(id)).toBeNull();
    }
  });

  it('RoomManager: without the registration a Defuser room is GAME_NOT_AVAILABLE; with it, a 4-seat room', async () => {
    const off = makeManager(1, createGameRegistry().get);
    expect(await code(off.manager.createRoom(alice, 'defuser', {}))).toBe('GAME_NOT_AVAILABLE');
    const on = makeManager(1, createGameRegistry({ defuserEnabled: true }).get);
    const room = await on.manager.createRoom(alice, 'defuser', {});
    expect(room).toMatchObject({
      gameType: 'defuser',
      maxPlayers: 4,
      settings: { difficulty: 'normal' },
    });
    expect(await code(on.manager.createRoom(bob, 'defuser', { difficulty: 'hard' }))).toBe(
      'VALIDATION_ERROR',
    );
  });
});

describe('DEFUSER_FIXED_SEED', () => {
  const edition = (s: DefuserState) => s.edition;
  const create = (fixedSeed?: string) => {
    const d = createGameRegistry({ defuserEnabled: true, defuserFixedSeed: fixedSeed ?? null }).get(
      'defuser',
    )!;
    return (random: () => number) =>
      d.createInitialState(
        { difficulty: 'normal' },
        { players: ['a', 'b', 'c'], firstPlayerIndex: 0, now: 0, random },
      ) as DefuserState;
  };

  it('a fixed seed makes the whole edition deterministic, whatever random() returns', () => {
    const make = create(SEED);
    const a = make(() => 0.1);
    const b = make(() => 0.9);
    expect(a.seed).toBe(SEED);
    expect(edition(a)).toEqual(edition(b));
    expect(edition(a)).toEqual(generateEdition({ seed: SEED, analystCount: 2 }));
    expect(a.holders).toEqual(b.holders);
  });

  it('a different seed gives an independent edition', () => {
    const a = edition(create(SEED)(() => 0.5));
    const b = edition(create(OTHER_SEED)(() => 0.5));
    expect(a.seed).not.toBe(b.seed);
    expect(a.solution).not.toEqual(b.solution);
    expect(a.fuse.panel.procedure).not.toEqual(b.fuse.panel.procedure);
    expect(a.valve.panel.reference).not.toEqual(b.valve.panel.reference);
  });

  it('without a fixed seed each game draws its own seed from the platform random()', () => {
    const make = create();
    let n = 0;
    const random = () => (n++ * 0.37 + 0.11) % 1;
    const a = make(random);
    const b = make(random);
    expect(a.seed).toMatch(/^[0-9a-f]{32}$/);
    expect(a.seed).not.toBe(b.seed);
    expect(a.seed).not.toBe(SEED);
  });

  it('RoomManager with its real CSPRNG-backed random: every game gets a different seed', async () => {
    const store = new InMemoryRoomStore();
    const manager = new RoomManager(
      store,
      {
        roomChanged: () => undefined,
        userRemoved: () => undefined,
        gameFinished: () => undefined,
        persistRoom: () => undefined,
      },
      pino({ level: 'silent' }),
      {
        roomTtlMs: 3_600_000,
        disconnectGraceMs: 60_000,
        games: createGameRegistry({ defuserEnabled: true }).get,
      },
    );
    const seeds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const host = { userId: `host${i}`.padEnd(24, '0'), displayName: 'H', photoUrl: null };
      const guest = { userId: `gest${i}`.padEnd(24, '0'), displayName: 'G', photoUrl: null };
      const room = await manager.createRoom(host, 'defuser', {});
      await manager.joinByInvite(guest, room.inviteToken);
      await manager.setReady(guest.userId, room.roomId, true, `ready_${i}_aaaa`);
      await manager.start(host.userId, room.roomId, `start_${i}_aaaa`);
      seeds.push(((await store.get(room.roomId))!.game!.state as DefuserState).seed);
    }
    manager.shutdown();
    expect(new Set(seeds).size).toBe(5);
    for (const seed of seeds) expect(seed).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('buildServer wiring (no database needed for these routes)', () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const c of closers.splice(0)) await c();
  });

  function server(env: Record<string, string>) {
    const config = loadConfig({
      NODE_ENV: 'test',
      JWT_SECRET: 'wiring-test-secret-'.padEnd(48, 'x'),
      LOG_LEVEL: 'silent',
      ...env,
    });
    const s = buildServer(config, createLogger('silent'));
    closers.push(() => s.close());
    const token = issueSession('aaaaaaaaaaaaaaaaaaaaaaaa', config.jwtSecret, 600).token;
    return { s, config, token };
  }

  it('by default Defuser is unregistered and the catalog lists it as coming_soon', async () => {
    const { s, token } = server({});
    const res = await request(s.httpServer)
      .get('/api/games')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.games.map((g: { id: string; status: string }) => [g.id, g.status])).toEqual([
      ['crack-the-code', 'live'],
      ['color-cipher', 'live'],
      ['defuser', 'coming_soon'],
    ]);
    expect(
      await code(
        s.rooms.createRoom({ userId: 'u1', displayName: 'A', photoUrl: null }, 'defuser', {}),
      ),
    ).toBe('GAME_NOT_AVAILABLE');
  });

  it('DEFUSER_ENABLED registers it for explicit use, still not advertised', async () => {
    const { s, token } = server({ DEFUSER_ENABLED: 'true', DEFUSER_FIXED_SEED: SEED });
    const snap = await s.rooms.createRoom(
      { userId: 'u1', displayName: 'A', photoUrl: null },
      'defuser',
      {},
    );
    expect(snap.gameType).toBe('defuser');
    const res = await request(s.httpServer)
      .get('/api/games')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.games.find((g: { id: string }) => g.id === 'defuser').status).toBe(
      'coming_soon',
    );
  });

  it('a staging server registers Defuser and offers it as preview; the live config cannot', async () => {
    const live = {
      NODE_ENV: 'production',
      BOT_TOKEN: '123:abc',
      JWT_SECRET: 'x'.repeat(40),
      MONGODB_URI: 'mongodb+srv://example/db',
      CLIENT_ORIGINS: 'https://rivalrush.vercel.app',
      LOG_LEVEL: 'silent',
    };
    const config = loadConfig({
      ...live,
      DEPLOY_ENV: 'staging',
      MONGODB_DB_NAME: 'rivalrush_staging',
      DEFUSER_ENABLED: 'true',
    });
    const s = buildServer(config, createLogger('silent'));
    closers.push(() => s.close());
    const token = issueSession('aaaaaaaaaaaaaaaaaaaaaaaa', config.jwtSecret, 600).token;
    const res = await request(s.httpServer)
      .get('/api/games')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.games.find((g: { id: string }) => g.id === 'defuser').status).toBe('preview');
    const snap = await s.rooms.createRoom(
      { userId: 'u1', displayName: 'A', photoUrl: null },
      'defuser',
      {},
    );
    expect(snap.gameType).toBe('defuser');
    expect(() => loadConfig({ ...live, DEFUSER_ENABLED: 'true' })).toThrow(/DEFUSER_ENABLED/);
  });

  it('production config refuses both flags before a server can be built', () => {
    const prod = {
      NODE_ENV: 'production',
      BOT_TOKEN: '123:abc',
      JWT_SECRET: 'x'.repeat(40),
      MONGODB_URI: 'mongodb+srv://example/db',
      CLIENT_ORIGINS: 'https://rivalrush.vercel.app',
    };
    expect(() => loadConfig({ ...prod, DEFUSER_ENABLED: 'true' })).toThrow(/DEFUSER_ENABLED/);
    expect(() => loadConfig({ ...prod, DEFUSER_FIXED_SEED: SEED })).toThrow(/DEFUSER_FIXED_SEED/);
    expect(loadConfig(prod).defuserEnabled).toBe(false);
  });
});

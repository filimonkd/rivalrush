import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import type {
  ClientToServerEvents,
  DefuserPlayerView,
  RoomEvent,
  RoomSnapshot,
  ServerToClientEvents,
} from '@rivalrush/shared';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueSession } from '../../src/auth/jwt.js';
import { createDefuser } from '../../src/games/defuser/game.js';
import { getGame } from '../../src/games/registry.js';
import { createLogger } from '../../src/logger.js';
import type { FinishedSession } from '../../src/matches/matchService.js';
import { InMemoryRoomStore } from '../../src/rooms/InMemoryRoomStore.js';
import { RoomManager } from '../../src/rooms/roomManager.js';
import { SocketLayer } from '../../src/websocket/socketServer.js';
import { SEED, solutionOf } from '../helpers/defuser.js';
import { aid, alice, bob, carol } from '../helpers/manager.js';

/**
 * Socket.IO with 3 real clients against a real HTTP server, RoomManager and the Defuser plug-in
 * (no database needed: rooms live in memory and match recording is captured).
 */
const SECRET = 'socket-test-secret-'.padEnd(48, 'x');
type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let http: HttpServer;
let rooms: RoomManager;
let sockets: SocketLayer;
let url: string;
const logLines: string[] = [];
const finished: FinishedSession[] = [];
const clients: Client[] = [];

beforeAll(async () => {
  const logger = createLogger(
    'debug',
    new Writable({
      write(chunk, _enc, cb) {
        logLines.push(String(chunk));
        cb();
      },
    }),
  );
  const defuser = createDefuser({ fixedSeed: SEED });
  http = createServer();
  sockets = new SocketLayer(http, { jwtSecret: SECRET, clientOrigins: ['http://x'], logger });
  rooms = new RoomManager(
    new InMemoryRoomStore(),
    {
      roomChanged: (room, events) => sockets.roomChanged(room, events),
      userRemoved: (roomId, userId, reason) => sockets.userRemoved(roomId, userId, reason),
      gameFinished: (s) => finished.push(s),
      persistRoom: () => undefined,
    },
    logger,
    {
      roomTtlMs: 3_600_000,
      disconnectGraceMs: 60_000,
      games: (id) => (id === 'defuser' ? defuser : getGame(id)),
    },
  );
  sockets.attach(rooms);
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  rooms.shutdown();
  await sockets.close();
  if (http.listening) await new Promise<void>((r) => http.close(() => r()));
});

function connect(userId: string): Promise<Client> {
  const c: Client = ioClient(url, {
    auth: { token: issueSession(userId, SECRET, 600).token },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  clients.push(c);
  return new Promise((resolve, reject) => {
    c.once('connect', () => resolve(c));
    c.once('connect_error', reject);
  });
}

type AckResult = {
  ok: boolean;
  data?: RoomSnapshot;
  error?: { code: string; details?: { rule?: string } };
};
const emit = (c: Client, event: string, payload: unknown) =>
  new Promise<AckResult>((resolve) =>
    (c as unknown as { emit: (e: string, p: unknown, cb: (r: AckResult) => void) => void }).emit(
      event,
      payload,
      resolve,
    ),
  );

describe('Defuser over Socket.IO (3 clients)', () => {
  it('per-recipient snapshots, public events, Analyst refusal, a full defuse and the debrief', async () => {
    const people = [alice, bob, carol];
    const created = await rooms.createRoom(alice, 'defuser', {});
    for (const p of people.slice(1)) {
      await rooms.joinByInvite(p, created.inviteToken);
      await rooms.setReady(p.userId, created.roomId, true, aid());
    }
    const roomId = created.roomId;
    const cs = await Promise.all(people.map((p) => connect(p.userId)));
    const snaps = new Map<string, RoomSnapshot[]>(people.map((p) => [p.userId, []]));
    const events = new Map<string, RoomEvent[]>(people.map((p) => [p.userId, []]));
    cs.forEach((c, i) => {
      c.on('room:snapshot', (s) => snaps.get(people[i]!.userId)!.push(s));
      c.on('room:event', (e) => events.get(people[i]!.userId)!.push(e));
    });
    for (const c of cs) expect((await emit(c, 'room:subscribe', { roomId })).ok).toBe(true);
    expect((await emit(cs[0]!, 'room:start', { roomId, actionId: aid() })).ok).toBe(true);

    const act = (i: number, action: unknown) =>
      emit(cs[i]!, 'game:action', { roomId, actionId: aid(), clientVersion: 0, action });
    for (let i = 0; i < 3; i++) expect((await act(i, { type: 'READY' })).ok).toBe(true);

    const latest = async (i: number) => {
      const r = await emit(cs[i]!, 'room:subscribe', { roomId });
      return r.data!;
    };
    const views = await Promise.all(
      [0, 1, 2].map(async (i) => (await latest(i)).game!.view as DefuserPlayerView),
    );
    expect(views.map((v) => v.phase)).toEqual(['ARMED', 'ARMED', 'ARMED']);
    expect(new Set(views.map((v) => v.version)).size).toBe(1);
    const opIndex = views.findIndex((v) => v.kind === 'operator');
    const analystIndex = views.findIndex((v) => v.kind === 'analyst');
    expect(opIndex).toBeGreaterThanOrEqual(0);
    expect(views.filter((v) => v.kind === 'analyst')).toHaveLength(2);

    // An Analyst can't touch the Charge.
    const refused = await act(analystIndex, { type: 'CUT_LINE', line: 1 });
    expect(refused.error).toMatchObject({
      code: 'INVALID_ACTION',
      details: { rule: 'not_operator' },
    });
    // A malformed action.
    expect((await act(opIndex, { type: 'CUT_LINE', line: 0 })).error?.code).toBe('INVALID_ACTION');

    const s = solutionOf(SEED, 2);
    const wrong = [1, 2, 3, 4, 5].find((l) => l !== s.fuse.line)!;
    expect((await act(opIndex, { type: 'CUT_LINE', line: wrong })).ok).toBe(true);
    for (const action of [
      { type: 'CUT_LINE', line: s.fuse.line },
      { type: 'PRESS_GLYPH', key: s.glyph.first },
      { type: 'PRESS_GLYPH', key: s.glyph.second },
      { type: 'SET_VALVE', ...s.valve },
    ]) {
      expect((await act(opIndex, action)).ok).toBe(true);
    }
    // Let the last broadcasts arrive.
    await new Promise((r) => setTimeout(r, 50));

    // Every member got the same public events, in the same order, with the same versions.
    const seq = (id: string) =>
      events
        .get(id)!
        .filter((e) => ['device_armed', 'fault', 'panel_solved', 'game_over'].includes(e.type))
        .map((e) => `${e.type}@${e.version}`);
    expect(seq(alice.userId)).toEqual(seq(bob.userId));
    expect(seq(alice.userId)).toEqual(seq(carol.userId));
    expect(seq(alice.userId).map((x) => x.split('@')[0])).toEqual([
      'device_armed',
      'fault',
      'panel_solved',
      'panel_solved',
      'panel_solved',
      'game_over',
    ]);
    const fault = events.get(bob.userId)!.find((e) => e.type === 'fault')!;
    expect(fault.data).toEqual({ panel: 'fuse', faults: 1, input: { line: wrong } });

    // While live, only the Operator's snapshots ever carried the Charge; Analysts only their sheets.
    for (const [id, list] of snaps) {
      for (const snap of list) {
        const v = snap.game?.view as DefuserPlayerView | undefined;
        if (!v || v.kind === 'debrief') continue;
        const json = JSON.stringify(snap);
        expect(json).not.toContain(SEED);
        if (v.kind !== 'operator') expect(json).not.toMatch(/"(balance|gauge|plate|lines|keys)"/);
        if (v.kind === 'operator') expect(json).not.toMatch(/"(heat|grid|frameValues|rules)"/);
        expect(v.me).toBe(id);
      }
    }
    // Events never carry the seed or the edition label.
    const label = views[0]!.editionLabel;
    for (const list of events.values()) {
      const json = JSON.stringify(list);
      expect(json).not.toContain(SEED);
      expect(json).not.toContain(`"${label}"`);
    }

    // The end: every member gets the debrief, and the match is recorded with the generator info.
    for (let i = 0; i < 3; i++)
      expect(((await latest(i)).game!.view as DefuserPlayerView).kind).toBe('debrief');
    expect(finished).toHaveLength(1);
    expect(finished[0]!.generator).toEqual({ version: 1, seed: SEED });
    expect(finished[0]!.result).toMatchObject({ kind: 'coop', outcome: 'defused', faults: 1 });

    // Logs: room and session ids, reason and outcome; never the seed or the edition label.
    const logs = logLines.join('');
    expect(logs).toContain('"event":"game.ended"');
    expect(logs).toContain('"outcome":"defused"');
    expect(logs).not.toContain(SEED);
    expect(logs).not.toContain(`"${label}"`);
  });
});

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
import request from 'supertest';
import { issueSession } from '../../src/auth/jwt.js';
import { loadConfig, type AppConfig } from '../../src/config/env.js';
import type { Edition } from '../../src/games/defuser/edition.js';
import { generateEdition } from '../../src/games/defuser/edition.js';
import { createLogger } from '../../src/logger.js';
import type { FinishedSession } from '../../src/matches/matchService.js';
import { buildServer, type RivalRushServer } from '../../src/server.js';
import { SEED } from './defuser.js';

/**
 * Backend harness for a real Defuser match over the existing boundary: the real `buildServer`
 * (Express + Socket.IO + RoomManager + the registered plug-in), real Socket.IO clients and real
 * REST calls. No browser and no UI. Differences from production, on purpose:
 *
 *  - No MongoDB: rooms are created/joined through RoomManager (the REST create/join routes need a
 *    user record; they are covered by test/integration/defuser.test.ts, which runs in CI), match
 *    recording is captured in memory, room metadata persistence is a no-op.
 *  - A frozen, controllable server clock (`h.advance`, `h.jump`): deadlines and grace periods are
 *    exact to the millisecond. It drives the server's own `now`, so every game decision still
 *    comes from the real server.
 */

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface RawAck {
  ok: boolean;
  data?: unknown;
  error?: AckResult['error'];
  snapshot?: RoomSnapshot;
}

export interface AckResult {
  ok: boolean;
  data?: RoomSnapshot;
  error?: { code: string; message?: string; details?: { rule?: string } };
}

const hexId = (prefix: string, i: number) => `${prefix}${i}`.padEnd(24, '0');

export class HarnessPlayer {
  socket: ClientSocket | null = null;
  readonly snapshots: RoomSnapshot[] = [];
  readonly events: RoomEvent[] = [];
  /** Every ack the server returned to this player (snapshots and errors). */
  readonly acks: AckResult[] = [];
  /** Every REST body this player received. */
  readonly rest: unknown[] = [];

  constructor(
    private readonly h: DefuserHarness,
    readonly userId: string,
    readonly name: string,
  ) {}

  get token(): string {
    return issueSession(this.userId, this.h.config.jwtSecret, 600).token;
  }

  /** Opens a socket and subscribes to the room, like the app does on open and on reconnect. */
  async connect(): Promise<RoomSnapshot> {
    const socket: ClientSocket = ioClient(this.h.url, {
      auth: { token: this.token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    this.socket = socket;
    this.h.sockets.push(socket);
    socket.on('room:snapshot', (s) => this.snapshots.push(s));
    socket.on('room:event', (e) => this.events.push(e));
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    const r = await this.emit('room:subscribe', { roomId: this.h.roomId });
    if (!r.ok) throw new Error(`subscribe refused: ${r.error?.code}`);
    return r.data!;
  }

  /** The connection dies without a Leave (a closed app, a lost signal). */
  drop(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  /**
   * Sends one event and resolves with the ack. A real client backs off when the server throttles
   * it (5 actions/s, burst 12 per connection), so this does too; production limits stay as is.
   */
  async emit(event: string, payload: unknown): Promise<AckResult> {
    for (let attempt = 0; attempt < 40; attempt++) {
      const r = await this.emitOnce(event, payload);
      if (r.error?.code !== 'RATE_LIMITED') {
        this.acks.push(r);
        if (r.snapshot) this.acks.push({ ok: true, data: r.snapshot });
        return r;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`${event}: still rate limited after 10 s`);
  }

  private emitOnce(
    event: string,
    payload: unknown,
  ): Promise<AckResult & { snapshot?: RoomSnapshot }> {
    const socket = this.socket;
    if (!socket) throw new Error(`${this.name} is not connected`);
    return new Promise((resolve) => {
      (
        socket as unknown as { emit: (e: string, p: unknown, cb: (r: unknown) => void) => void }
      ).emit(event, payload, (raw: unknown) => {
        const r = raw as RawAck;
        resolve({
          ok: r.ok,
          ...(r.ok ? { data: r.data as RoomSnapshot } : { error: r.error }),
          ...(r.snapshot ? { snapshot: r.snapshot } : {}),
        });
      });
    });
  }

  private nextId = 0;
  /** A game action over the socket (`game:action`). The client only ever sends an intent. */
  act(action: unknown, actionId = `${this.userId.slice(0, 6)}_${++this.nextId}_${this.h.uid}`) {
    return this.emit('game:action', {
      roomId: this.h.roomId,
      actionId,
      clientVersion: 0,
      action,
    });
  }

  /** Room-level commands. */
  roomReady() {
    return this.emit('room:ready', {
      roomId: this.h.roomId,
      ready: true,
      actionId: this.id('rdy'),
    });
  }
  roomStart() {
    return this.emit('room:start', { roomId: this.h.roomId, actionId: this.id('start') });
  }
  roomRematch() {
    return this.emit('room:rematch', { roomId: this.h.roomId, actionId: this.id('rm') });
  }
  roomLeave() {
    return this.emit('room:leave', { roomId: this.h.roomId, actionId: this.id('lv') });
  }
  resync() {
    return this.emit('game:resync', { roomId: this.h.roomId, knownVersion: 0 });
  }
  private id(tag: string) {
    return `${tag}_${this.userId.slice(0, 6)}_${++this.nextId}_${this.h.uid}`;
  }

  /** A REST GET as this player; the body is recorded for leak scans. */
  async get(path: string): Promise<{ status: number; body: unknown }> {
    const res = await request(this.h.server.httpServer)
      .get(path)
      .set('Authorization', `Bearer ${this.token}`);
    this.rest.push(res.body);
    return { status: res.status, body: res.body };
  }

  /** The most recent snapshot this player was pushed or acked. */
  latest(): RoomSnapshot {
    const acked = this.acks
      .map((a) => a.data)
      .filter((d): d is RoomSnapshot => !!d && 'roomId' in d && 'version' in d);
    const all = [...this.snapshots, ...acked];
    if (all.length === 0) throw new Error(`${this.name} has no snapshot`);
    return all.reduce((a, b) => (b.version >= a.version ? b : a));
  }
  /** The newest Defuser view of `latest()` (pushed or acked). */
  latestView(): DefuserPlayerView {
    const v = this.latest().game?.view;
    if (!v || v.gameId !== 'defuser') throw new Error(`${this.name} has no Defuser view`);
    return v;
  }
  /** The newest Defuser view (from the live socket; use after `h.settle()`). */
  view(): DefuserPlayerView {
    const v = this.snapshots.at(-1)?.game?.view;
    if (!v || v.gameId !== 'defuser') throw new Error(`${this.name} has no Defuser view`);
    return v;
  }
  /** Every serializable payload this player ever received, by channel. */
  payloads() {
    return {
      snapshots: this.snapshots,
      acks: this.acks,
      events: this.events,
      rest: this.rest,
    };
  }
}

export interface HarnessOptions {
  /** Players in the room, 2–4. */
  players: number;
  /** Fixed 128-bit seed (default: the shared test seed). */
  seed?: string;
  /** Extra env for loadConfig. */
  env?: Record<string, string>;
}

export class DefuserHarness {
  readonly sockets: ClientSocket[] = [];
  readonly players: HarnessPlayer[] = [];
  readonly finished: FinishedSession[] = [];
  readonly logLines: string[] = [];
  readonly uid = Math.random().toString(36).slice(2, 8);
  /** Frozen start time + explicit advances: the server clock only moves when a test says so. */
  private base = Date.now();
  private frozen = false;
  private offset = 0;
  roomId = '';
  inviteToken = '';
  url = '';
  server!: RivalRushServer;
  config!: AppConfig;
  seed = SEED;

  static async start(opts: HarnessOptions): Promise<DefuserHarness> {
    const h = new DefuserHarness();
    h.seed = opts.seed ?? SEED;
    h.config = loadConfig({
      NODE_ENV: 'test',
      JWT_SECRET: 'harness-secret-'.padEnd(48, 'x'),
      CLIENT_ORIGINS: 'http://localhost:5173',
      LOG_LEVEL: 'debug',
      DEFUSER_ENABLED: 'true',
      DEFUSER_FIXED_SEED: h.seed,
      ...opts.env,
    });
    const logger = createLogger(
      'debug',
      new Writable({
        write(chunk, _enc, cb) {
          h.logLines.push(String(chunk));
          cb();
        },
      }),
    );
    h.frozen = true;
    h.server = buildServer(h.config, logger, {
      now: () => h.now(),
      recordMatch: async (s) => {
        h.finished.push(s);
        return 'recorded';
      },
    });
    // No database: room metadata persistence is not part of what this harness exercises.
    h.server.roomRepo.persist = () => undefined;
    await new Promise<void>((r) => h.server.httpServer.listen(0, '127.0.0.1', r));
    h.url = `http://127.0.0.1:${(h.server.httpServer.address() as AddressInfo).port}`;

    for (let i = 0; i < opts.players; i++) {
      h.players.push(new HarnessPlayer(h, hexId('d0ca', i), ['Ana', 'Ben', 'Cy', 'Dee'][i]!));
    }
    const host = h.players[0]!;
    const room = await h.server.rooms.createRoom(
      { userId: host.userId, displayName: host.name, photoUrl: null },
      'defuser',
      {},
    );
    h.roomId = room.roomId;
    h.inviteToken = room.inviteToken;
    for (const p of h.players.slice(1)) {
      await h.server.rooms.joinByInvite(
        { userId: p.userId, displayName: p.name, photoUrl: null },
        room.inviteToken,
      );
    }
    return h;
  }

  /**
   * Wraps a server that already exists (the Mongo integration tests, with real users and REST
   * room creation) so the same clients and scans can be reused. Uses the real clock.
   */
  static attach(opts: {
    server: RivalRushServer;
    config: AppConfig;
    url: string;
    roomId: string;
    inviteToken: string;
    seed: string;
    players: Array<{ userId: string; name: string }>;
  }): DefuserHarness {
    const h = new DefuserHarness();
    Object.assign(h, {
      server: opts.server,
      config: opts.config,
      url: opts.url,
      roomId: opts.roomId,
      inviteToken: opts.inviteToken,
      seed: opts.seed,
    });
    for (const p of opts.players) h.players.push(new HarnessPlayer(h, p.userId, p.name));
    return h;
  }

  /** The whole edition for this seed and team size (test-side knowledge, never sent anywhere). */
  edition(): Edition {
    return generateEdition({ seed: this.seed, analystCount: this.players.length - 1 });
  }

  /** Connects everyone, readies the guests, and has the host start the game. */
  async startGame(): Promise<void> {
    for (const p of this.players) if (!p.socket) await p.connect();
    for (const p of this.players.slice(1)) await p.roomReady();
    const r = await this.players[0]!.roomStart();
    if (!r.ok) throw new Error(`start refused: ${r.error?.code}`);
    await this.settle();
  }

  /** Everyone taps Ready in the briefing, which arms the Charge. */
  async armAll(): Promise<void> {
    for (const p of this.players) await p.act({ type: 'READY' });
    await this.settle();
  }

  /** Advances the server's clock and applies every deadline that became due. */
  async advance(ms: number): Promise<void> {
    this.offset += ms;
    await (this.server.rooms as unknown as { tick(roomId: string): Promise<void> }).tick(
      this.roomId,
    );
    await this.settle();
  }

  /**
   * Moves the server clock WITHOUT applying deadlines, so the next action finds a deadline that
   * is already due (the exact-deadline race: the server must apply the timeout first).
   */
  jump(ms: number): void {
    this.offset += ms;
  }

  now(): number {
    return (this.frozen ? this.base : Date.now()) + this.offset;
  }

  /** Lets pushed snapshots and events arrive. */
  settle(ms = 60): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** The roster (roles) as the newest snapshot of any connected player shows it. */
  roster() {
    // Game versions restart every game; room versions never do, so pick by those.
    let best: RoomSnapshot | null = null;
    for (const p of this.players) {
      const snap = p.snapshots.at(-1);
      if (snap?.game?.view.gameId === 'defuser' && (!best || snap.version > best.version))
        best = snap;
    }
    if (!best) throw new Error('no game view yet');
    return (best.game!.view as DefuserPlayerView).roster;
  }
  /** The active Operator (by roster, so it also works after the game ends). */
  operator(): HarnessPlayer {
    const id = this.roster().find((r) => r.role === 'operator')?.userId;
    const op = this.players.find((p) => p.userId === id);
    if (!op) throw new Error('no Operator');
    return op;
  }
  /** Active Analysts, earliest letter first. */
  analysts(): HarnessPlayer[] {
    return this.roster()
      .filter((r) => r.role === 'analyst')
      .sort((a, b) => (a.letter ?? '').localeCompare(b.letter ?? ''))
      .map((r) => this.players.find((p) => p.userId === r.userId)!);
  }

  /** Solves all three panels as the Operator (uses the test-side solution). */
  async defuse(operator = this.operator()): Promise<void> {
    const s = this.edition().solution;
    await operator.act({ type: 'CUT_LINE', line: s.fuse.line });
    await operator.act({ type: 'PRESS_GLYPH', key: s.glyph.first });
    await operator.act({ type: 'PRESS_GLYPH', key: s.glyph.second });
    await operator.act({ type: 'SET_VALVE', ...s.valve });
    await this.settle();
  }

  /** A line that is not the answer (and not yet cut). */
  wrongLine(): number {
    const answer = this.edition().solution.fuse.line;
    const cut = (this.operator().view() as { cutLines: number[] }).cutLines;
    return [1, 2, 3, 4, 5].find((l) => l !== answer && !cut.includes(l))!;
  }

  async close(): Promise<void> {
    for (const s of this.sockets) s.disconnect();
    await this.server.close();
  }
}

export const startHarness = (opts: HarnessOptions) => DefuserHarness.start(opts);

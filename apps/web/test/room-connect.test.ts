// @vitest-environment jsdom
import type { RoomSnapshot } from '@rivalrush/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A stand-in for a Socket.IO client socket that the test connects by hand. */
class FakeSocket {
  connected = false;
  active = false;
  emitted: string[] = [];
  connectCalls = 0;
  private handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  on(ev: string, fn: (...a: unknown[]) => void) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev)!.add(fn);
    return this;
  }
  off(ev: string, fn: (...a: unknown[]) => void) {
    this.handlers.get(ev)?.delete(fn);
    return this;
  }
  connect() {
    this.connectCalls++;
    this.active = true;
    return this;
  }
  disconnect() {
    this.connected = false;
    this.active = false;
    return this;
  }
  /** The server answers every request with the room. */
  emit(ev: string, _payload: unknown, ack?: (r: unknown) => void) {
    this.emitted.push(ev);
    if (ev === 'game:resync') ack?.({ ok: true, data: { changed: false } });
    else ack?.({ ok: true, data: room() });
    return this;
  }
  fire(ev: string) {
    if (ev === 'connect') this.connected = true;
    if (ev === 'disconnect') this.connected = false;
    for (const fn of [...(this.handlers.get(ev) ?? [])]) fn();
  }
}

let fake: FakeSocket;
// Like the real client, a new socket starts connecting at once (autoConnect).
vi.mock('socket.io-client', () => ({
  io: () => {
    fake.active = true;
    return fake;
  },
}));

const room = (): RoomSnapshot =>
  ({
    roomId: 'room00000001',
    version: 2,
    serverTime: Date.now(),
    players: [{ userId: 'u1', displayName: 'Carla' }],
  }) as unknown as RoomSnapshot;

const { useRoom, FIRST_CONNECT_WAIT_MS } = await import('../src/store/room');
const { useSession } = await import('../src/store/session');

beforeEach(() => {
  fake = new FakeSocket();
  useSession.setState({ token: `token-${Math.random()}` });
  useRoom.setState({ roomId: null, snapshot: null });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the first connection after entering a room', () => {
  it('a tap while the new socket is still opening waits for it and goes through', async () => {
    await useRoom.getState().enter('room00000001', room());
    const ready = useRoom.getState().setReady(true);
    await Promise.resolve();
    expect(fake.emitted).not.toContain('room:ready');
    fake.fire('connect');
    await expect(ready).resolves.toBeNull();
    expect(fake.emitted).toContain('room:ready');
  });

  it('gives up with Reconnecting if the socket never opens', async () => {
    vi.useFakeTimers();
    await useRoom.getState().enter('room00000001', room());
    const ready = useRoom.getState().setReady(true);
    await vi.advanceTimersByTimeAsync(FIRST_CONNECT_WAIT_MS);
    await expect(ready).resolves.toMatchObject({ code: 'RECONNECT_REQUIRED' });
    expect(fake.emitted).not.toContain('room:ready');
  });

  it('a socket that was connected and dropped still fails fast', async () => {
    await useRoom.getState().enter('room00000001', room());
    fake.fire('connect');
    fake.fire('disconnect');
    const started = Date.now();
    await expect(useRoom.getState().setReady(true)).resolves.toMatchObject({
      code: 'RECONNECT_REQUIRED',
    });
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('entering a room more than once while connecting', () => {
  it('never sends a second connect for a socket that is already connecting', async () => {
    // The Join page enters the room, then the room page enters it again on mount.
    await useRoom.getState().enter('room00000001', room());
    await useRoom.getState().enter('room00000001');
    expect(fake.connectCalls).toBe(0);
    // A first connection is "Connecting…", not "Reconnecting…".
    expect(useRoom.getState().connection).toBe('connecting');
    fake.fire('connect');
    await expect(useRoom.getState().setReady(true)).resolves.toBeNull();
  });

  it('wakes a stopped socket once, and calls it reconnecting after a drop', async () => {
    await useRoom.getState().enter('room00000001', room());
    fake.fire('connect');
    fake.disconnect();
    await useRoom.getState().enter('room00000001');
    expect(fake.connectCalls).toBe(1);
    expect(useRoom.getState().connection).toBe('reconnecting');
    await useRoom.getState().enter('room00000001');
    expect(fake.connectCalls).toBe(1);
  });
});

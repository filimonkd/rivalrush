import type {
  Ack,
  AppErrorPayload,
  ClientToServerEvents,
  PlayerAction,
  ResyncResult,
  RoomClosedPayload,
  RoomEvent,
  RoomSnapshot,
  ServerToClientEvents,
} from '@rivalrush/shared';
import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import { api, API_URL } from '../lib/api';
import { serverOffset } from '../lib/clock';
import { newActionId } from '../lib/ids';
import { haptic, onForeground } from '../lib/telegram';
import { acceptSnapshot, describeEvent, rememberNames } from './roomLogic';
import { useSession } from './session';
import { toast } from './toasts';

type Connection = 'idle' | 'connecting' | 'online' | 'reconnecting';
type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface RoomState {
  roomId: string | null;
  snapshot: RoomSnapshot | null;
  /** Names seen in this room's snapshots, by user id (a teammate who left has no seat). */
  names: Record<string, string>;
  /** serverTime - local time, for countdowns. */
  offset: number;
  connection: Connection;
  closed: RoomClosedPayload | null;
  error: AppErrorPayload | null;
  enter(roomId: string, initial?: RoomSnapshot): Promise<void>;
  exit(): void;
  /** Catches up with the server. Resolves false if the server did not answer in time. */
  resync(timeoutMs?: number): Promise<boolean>;
  setReady(ready: boolean): Promise<AppErrorPayload | null>;
  start(): Promise<AppErrorPayload | null>;
  rematch(): Promise<AppErrorPayload | null>;
  leave(): Promise<void>;
  act(action: PlayerAction): Promise<AppErrorPayload | null>;
}

let socket: AppSocket | null = null;
let socketToken: string | null = null;
/** Whether the current socket has connected at least once. */
let everConnected = false;
let stopForeground: (() => void) | null = null;

/** How long a tap made while a brand-new socket is still connecting waits for it. */
export const FIRST_CONNECT_WAIT_MS = 5000;

/** Resolves when `s` connects, or after `ms`, whichever comes first. */
function connected(s: AppSocket, ms: number): Promise<void> {
  if (s.connected) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      s.off('connect', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    s.on('connect', done);
  });
}

async function call<T>(
  event: keyof ClientToServerEvents,
  payload: unknown,
  timeoutMs = 8000,
): Promise<Ack<T>> {
  // Right after entering a room the socket is still opening: a tap then (e.g. Ready straight
  // after joining) waits for it briefly instead of failing. A socket that was connected and
  // dropped still fails fast, so callers can fall back (Leave uses REST) or show "Reconnecting".
  if (socket && !socket.connected && !everConnected) {
    await connected(socket, Math.min(timeoutMs, FIRST_CONNECT_WAIT_MS));
  }
  return new Promise((resolve) => {
    if (!socket || !socket.connected) {
      resolve({
        ok: false,
        error: { code: 'RECONNECT_REQUIRED', message: 'Reconnecting… your game is safe.' },
      });
      return;
    }
    const timer = setTimeout(
      () =>
        resolve({
          ok: false,
          error: { code: 'RECONNECT_REQUIRED', message: 'Reconnecting… your game is safe.' },
        }),
      timeoutMs,
    );
    (socket.emit as (e: string, p: unknown, cb: (r: Ack<T>) => void) => void)(
      event,
      payload,
      (r) => {
        clearTimeout(timer);
        resolve(r);
      },
    );
  });
}

export const useRoom = create<RoomState>((set, get) => {
  const apply = (snap: RoomSnapshot) => {
    const next = acceptSnapshot(get().snapshot, snap, get().roomId);
    if (next !== get().snapshot) {
      set({
        snapshot: next,
        offset: serverOffset(snap.serverTime, Date.now()),
        names: next ? rememberNames(get().names, next) : get().names,
      });
    }
  };

  const onEvent = (e: RoomEvent) => {
    if (e.roomId !== get().roomId) return;
    const d = describeEvent(e, get().snapshot, useSession.getState().user?.id ?? null);
    if (!d) return;
    toast(d.text, d.kind);
    if (d.haptic) haptic[d.haptic]();
  };

  const ensureSocket = (): AppSocket => {
    const token = useSession.getState().token;
    if (socket && socketToken === token) return socket;
    socket?.disconnect();
    socketToken = token;
    everConnected = false;
    socket = io(API_URL || undefined, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    }) as AppSocket;
    socket.on('connect', () => {
      everConnected = true;
      set({ connection: 'online' });
      void get().resync();
    });
    socket.on('disconnect', () => {
      if (get().roomId) set({ connection: 'reconnecting' });
    });
    socket.on('connect_error', (err) => {
      if (!get().roomId) return;
      // The server refused the session token: Socket.IO will not retry this on its own.
      if (err.message === 'UNAUTHORIZED') {
        set({
          connection: 'idle',
          error: {
            code: 'UNAUTHORIZED',
            message: 'Your session ended. Close the app and open it again from the bot.',
          },
        });
        return;
      }
      set({ connection: 'reconnecting' });
    });
    socket.on('room:snapshot', apply);
    socket.on('room:event', onEvent);
    socket.on('room:closed', (p) => {
      if (p.roomId === get().roomId) set({ closed: p });
    });
    stopForeground?.();
    // Telegram backgrounding can freeze the socket: on return, reconnect and catch up.
    stopForeground = onForeground(() => {
      const s = socket;
      if (!s) return;
      if (!s.connected) {
        s.connect();
        return;
      }
      // A socket that slept in the background can look connected while it is dead (the
      // heartbeat takes up to ~40 s to notice). No quick answer → reconnect now.
      void get()
        .resync(3000)
        .then((answered) => {
          if (answered || socket !== s || !get().roomId) return;
          set({ connection: 'reconnecting' });
          s.disconnect().connect();
        });
    });
    return socket;
  };

  const command = async (
    event: keyof ClientToServerEvents,
    extra: Record<string, unknown> = {},
  ) => {
    const roomId = get().roomId;
    if (!roomId) return null;
    const r = await call<RoomSnapshot>(event, { roomId, actionId: newActionId(), ...extra });
    if (r.ok) {
      apply(r.data);
      return null;
    }
    if (r.snapshot) apply(r.snapshot);
    return r.error;
  };

  return {
    roomId: null,
    snapshot: null,
    names: {},
    offset: 0,
    connection: 'idle',
    closed: null,
    error: null,

    async enter(roomId, initial) {
      if (get().roomId !== roomId)
        set({ roomId, snapshot: initial ?? null, names: {}, closed: null, error: null });
      else if (initial) apply(initial);
      const s = ensureSocket();
      if (!s.connected) {
        set({ connection: everConnected ? 'reconnecting' : 'connecting' });
        // An active socket is already connecting (or retrying): a second connect() would send a
        // second CONNECT and leave a ghost socket on the server. Only wake a stopped one.
        if (!s.active) s.connect();
        return; // 'connect' handler resyncs
      }
      set({ connection: 'online' });
      await get().resync();
    },

    exit() {
      set({
        roomId: null,
        snapshot: null,
        names: {},
        closed: null,
        error: null,
        connection: socket?.connected ? 'online' : 'idle',
      });
    },

    async resync(timeoutMs) {
      const roomId = get().roomId;
      if (!roomId) return true;
      const r = await call<ResyncResult>(
        'game:resync',
        { roomId, knownVersion: get().snapshot?.version },
        timeoutMs,
      );
      if (r.ok) {
        if (r.data.changed) apply(r.data.room);
        set({ error: null });
        return true;
      }
      if (r.error.code === 'RECONNECT_REQUIRED') return false;
      if (r.error.code !== 'RATE_LIMITED') set({ error: r.error });
      return true;
    },

    setReady: (ready) => command('room:ready', { ready }),
    start: () => command('room:start'),
    rematch: () => command('room:rematch'),

    async leave() {
      const roomId = get().roomId;
      if (!roomId) return;
      const r = await call<{ left: true }>('room:leave', { roomId, actionId: newActionId() });
      if (!r.ok) {
        // Offline: fall back to REST so leaving never silently fails.
        await api(`/rooms/${roomId}/leave`, { method: 'POST', body: {} }).catch(() => undefined);
      }
      get().exit();
    },

    async act(action) {
      const roomId = get().roomId;
      const version = get().snapshot?.game?.version;
      if (!roomId || version === undefined) return null;
      const r = await call<RoomSnapshot>('game:action', {
        roomId,
        actionId: newActionId(),
        clientVersion: version,
        action,
      });
      if (r.ok) {
        apply(r.data);
        return null;
      }
      if (r.snapshot) apply(r.snapshot);
      return r.error;
    },
  };
});

export function disconnectSocket(): void {
  stopForeground?.();
  socket?.disconnect();
  socket = null;
}

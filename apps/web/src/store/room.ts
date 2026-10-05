import type {
  Ack,
  AppErrorPayload,
  ClientToServerEvents,
  CtcPlayerAction,
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
import { acceptSnapshot, describeEvent } from './roomLogic';
import { useSession } from './session';
import { toast } from './toasts';

type Connection = 'idle' | 'connecting' | 'online' | 'reconnecting';
type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface RoomState {
  roomId: string | null;
  snapshot: RoomSnapshot | null;
  /** serverTime - local time, for countdowns. */
  offset: number;
  connection: Connection;
  closed: RoomClosedPayload | null;
  error: AppErrorPayload | null;
  enter(roomId: string, initial?: RoomSnapshot): Promise<void>;
  exit(): void;
  resync(): Promise<void>;
  setReady(ready: boolean): Promise<AppErrorPayload | null>;
  start(): Promise<AppErrorPayload | null>;
  rematch(): Promise<AppErrorPayload | null>;
  leave(): Promise<void>;
  act(action: CtcPlayerAction): Promise<AppErrorPayload | null>;
}

let socket: AppSocket | null = null;
let socketToken: string | null = null;
let stopForeground: (() => void) | null = null;

function call<T>(event: keyof ClientToServerEvents, payload: unknown): Promise<Ack<T>> {
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
      8000,
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
      set({ snapshot: next, offset: serverOffset(snap.serverTime, Date.now()) });
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
    socket = io(API_URL || undefined, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    }) as AppSocket;
    socket.on('connect', () => {
      set({ connection: 'online' });
      void get().resync();
    });
    socket.on('disconnect', () => {
      if (get().roomId) set({ connection: 'reconnecting' });
    });
    socket.on('connect_error', () => {
      if (get().roomId) set({ connection: 'reconnecting' });
    });
    socket.on('room:snapshot', apply);
    socket.on('room:event', onEvent);
    socket.on('room:closed', (p) => {
      if (p.roomId === get().roomId) set({ closed: p });
    });
    stopForeground?.();
    // Telegram backgrounding can freeze the socket: on return, reconnect and catch up.
    stopForeground = onForeground(() => {
      if (!socket?.connected) socket?.connect();
      else void get().resync();
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
    offset: 0,
    connection: 'idle',
    closed: null,
    error: null,

    async enter(roomId, initial) {
      if (get().roomId !== roomId)
        set({ roomId, snapshot: initial ?? null, closed: null, error: null });
      else if (initial) apply(initial);
      const s = ensureSocket();
      if (!s.connected) {
        set({ connection: s.active ? 'reconnecting' : 'connecting' });
        s.connect();
        return; // 'connect' handler resyncs
      }
      set({ connection: 'online' });
      await get().resync();
    },

    exit() {
      set({
        roomId: null,
        snapshot: null,
        closed: null,
        error: null,
        connection: socket?.connected ? 'online' : 'idle',
      });
    },

    async resync() {
      const roomId = get().roomId;
      if (!roomId) return;
      const r = await call<ResyncResult>('game:resync', {
        roomId,
        knownVersion: get().snapshot?.version,
      });
      if (r.ok) {
        if (r.data.changed) apply(r.data.room);
        set({ error: null });
      } else if (r.error.code !== 'RECONNECT_REQUIRED' && r.error.code !== 'RATE_LIMITED') {
        set({ error: r.error });
      }
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

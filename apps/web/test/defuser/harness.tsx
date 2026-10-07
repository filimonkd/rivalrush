import type { DefuserPlayerAction, PlayerAction, RoomSnapshot } from '@rivalrush/shared';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { Toaster } from '../../src/components/Toaster';
import { DefuserGame } from '../../src/features/defuser/DefuserGame';
import type { View } from '../../src/features/defuser/model';
import { useRoom } from '../../src/store/room';
import { useToasts } from '../../src/store/toasts';
import fixtures from './fixtures.json';

/**
 * Room snapshots carrying real Defuser role views, as the server plug-in builds them (a fixed
 * seed, 2–4 players, every phase and view kind). Deadlines are re-based on the test clock. The
 * server test `defuser-web-fixtures.test.ts` fails if the plug-in's views stop matching them.
 */
export type Scene = keyof typeof fixtures;

export function scene(name: Scene, msLeft = 187_000): RoomSnapshot {
  const snap = structuredClone(fixtures[name]) as unknown as RoomSnapshot;
  const now = Date.now();
  snap.serverTime = now;
  const view = snap.game!.view as View;
  if (view.phase === 'BRIEFING') view.briefingDeadlineAt = now + 14_000;
  if (view.phase === 'ARMED') view.deadlineAt = now + msLeft;
  return snap;
}

export const viewOf = (snap: RoomSnapshot) => snap.game!.view as View;

/** A newer snapshot of the same room, as the server would push after a change. */
export function next(prev: RoomSnapshot, change: (view: View, snap: RoomSnapshot) => void) {
  const snap = structuredClone(prev);
  snap.version += 1;
  const view = snap.game!.view as View;
  view.version += 1;
  snap.game!.version = view.version;
  change(view, snap);
  return snap;
}

export interface Harness {
  sent: DefuserPlayerAction[];
  act: ReturnType<typeof vi.fn>;
  resync: ReturnType<typeof vi.fn>;
  rematch: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
  push(snap: RoomSnapshot): void;
  toasts(): string[];
}

function Screen() {
  const room = useRoom((s) => s.snapshot);
  return room ? <DefuserGame room={room} /> : null;
}

/**
 * Mounts the Defuser screen against the real room store with its network calls replaced: actions
 * are recorded (intents only) and the server's answer is whatever `answer` returns.
 */
export function mount(
  snap: RoomSnapshot,
  answer: (a: DefuserPlayerAction) => unknown = () => null,
): Harness {
  const sent: DefuserPlayerAction[] = [];
  const actFn = vi.fn(async (a: PlayerAction) => {
    sent.push(a as DefuserPlayerAction);
    return answer(a as DefuserPlayerAction) ?? null;
  });
  const resync = vi.fn(async () => true);
  const rematch = vi.fn(async () => null);
  const leave = vi.fn(async () => undefined);
  useToasts.setState({ toasts: [] });
  useRoom.setState({
    roomId: snap.roomId,
    snapshot: snap,
    names: {},
    offset: 0,
    connection: 'online',
    act: actFn as never,
    resync,
    rematch,
    leave,
  });
  render(
    <MemoryRouter>
      <Toaster />
      <Screen />
    </MemoryRouter>,
  );
  return {
    sent,
    act: actFn,
    resync,
    rematch,
    leave,
    push(s) {
      act(() => useRoom.setState({ snapshot: s }));
    },
    toasts: () => useToasts.getState().toasts.map((t) => t.text),
  };
}

export function reset() {
  cleanup();
  useRoom.setState({ snapshot: null, roomId: null, names: {} });
  vi.useRealTimers();
}

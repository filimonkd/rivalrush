import type { RoomEvent } from '@rivalrush/shared';
import { pino } from 'pino';
import type { CtcState } from '../../src/games/crack-the-code/game.js';
import type { FinishedSession } from '../../src/matches/matchService.js';
import { InMemoryRoomStore } from '../../src/rooms/InMemoryRoomStore.js';
import { RoomManager, type RemovalReason } from '../../src/rooms/roomManager.js';
import type { LiveRoom } from '../../src/rooms/types.js';
import type { SeatIdentity } from '../../src/users/userService.js';
import { seededRandom } from './random.js';

export const alice: SeatIdentity = {
  userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  displayName: 'Alice',
  photoUrl: null,
};
export const bob: SeatIdentity = {
  userId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  displayName: 'Bob',
  photoUrl: null,
};
export const carol: SeatIdentity = {
  userId: 'cccccccccccccccccccccccc',
  displayName: 'Carol',
  photoUrl: null,
};

export const GRACE_MS = 60_000;
export const TTL_MS = 120 * 60_000;

export function makeManager(seed = 1) {
  const store = new InMemoryRoomStore();
  const changes: Array<{ room: LiveRoom; events: RoomEvent[] }> = [];
  const removed: Array<{ roomId: string; userId: string; reason: RemovalReason }> = [];
  const finished: FinishedSession[] = [];
  const persisted: LiveRoom[] = [];
  const manager = new RoomManager(
    store,
    {
      roomChanged: (room, events) => changes.push({ room: structuredClone(room), events }),
      userRemoved: (roomId, userId, reason) => removed.push({ roomId, userId, reason }),
      gameFinished: (s) => finished.push(s),
      persistRoom: (room) => persisted.push(structuredClone(room)),
    },
    pino({ level: 'silent' }),
    { roomTtlMs: TTL_MS, disconnectGraceMs: GRACE_MS, random: seededRandom(seed) },
  );
  const raw = async (roomId: string) => (await store.get(roomId))!;
  const state = async (roomId: string) => (await raw(roomId)).game!.state as CtcState;
  return { manager, store, changes, removed, finished, persisted, raw, state };
}

let n = 0;
export const aid = () => `act_${(++n).toString().padStart(6, '0')}`;

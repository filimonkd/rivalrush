import type { LiveRoom } from './types.js';

/**
 * Storage for live room state. Async on purpose so a RedisRoomStore can implement the
 * same contract. Callers must hold the room's lock while doing get → mutate → save.
 */
export interface RoomStore {
  get(roomId: string): Promise<LiveRoom | null>;
  getByInviteToken(token: string): Promise<LiveRoom | null>;
  /** Non-terminal rooms (not CLOSED/EXPIRED) where the user holds a seat. */
  findActiveByMember(userId: string): Promise<LiveRoom | null>;
  save(room: LiveRoom): Promise<void>;
  delete(roomId: string): Promise<void>;
  list(): Promise<LiveRoom[]>;
}

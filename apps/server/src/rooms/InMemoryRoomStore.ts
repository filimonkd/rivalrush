import { TERMINAL_ROOM_STATUSES } from '@rivalrush/shared';
import type { RoomStore } from './RoomStore.js';
import type { LiveRoom } from './types.js';

/**
 * MVP RoomStore: a process-local Map. Values are deep-copied on the way in and out so
 * code behaves exactly as it would against an external store (no shared references).
 */
export class InMemoryRoomStore implements RoomStore {
  private rooms = new Map<string, LiveRoom>();
  private byInvite = new Map<string, string>();

  async get(roomId: string): Promise<LiveRoom | null> {
    const r = this.rooms.get(roomId);
    return r ? structuredClone(r) : null;
  }

  async getByInviteToken(token: string): Promise<LiveRoom | null> {
    const id = this.byInvite.get(token);
    return id ? this.get(id) : null;
  }

  async findActiveByMember(userId: string): Promise<LiveRoom | null> {
    for (const r of this.rooms.values()) {
      if (TERMINAL_ROOM_STATUSES.includes(r.status)) continue;
      if (r.seats.some((s) => s.userId === userId)) return structuredClone(r);
    }
    return null;
  }

  async save(room: LiveRoom): Promise<void> {
    this.rooms.set(room.roomId, structuredClone(room));
    this.byInvite.set(room.inviteToken, room.roomId);
  }

  async delete(roomId: string): Promise<void> {
    const r = this.rooms.get(roomId);
    if (r) this.byInvite.delete(r.inviteToken);
    this.rooms.delete(roomId);
  }

  async list(): Promise<LiveRoom[]> {
    return [...this.rooms.values()].map((r) => structuredClone(r));
  }
}

import type { InvitePreview, PlayerSeat, RoomSnapshot } from '@rivalrush/shared';
import type { AnyGameDefinition } from '../games/engine/types.js';
import { getGame } from '../games/registry.js';
import type { LiveRoom } from './types.js';

function seatView(room: LiveRoom, s: LiveRoom['seats'][number]): PlayerSeat {
  return {
    userId: s.userId,
    displayName: s.displayName,
    photoUrl: s.photoUrl,
    isHost: s.userId === room.hostId,
    ready: s.ready,
    online: s.connections > 0,
    wantsRematch: s.wantsRematch,
    graceDeadlineAt: s.graceDeadlineAt,
  };
}

/**
 * Builds the snapshot for ONE viewer. The raw game state never leaves the server: the
 * game's getPlayerView decides what this viewer may see (their own secret only).
 */
export function buildSnapshot(
  room: LiveRoom,
  viewerId: string,
  now: number,
  lookupGame: (id: string) => AnyGameDefinition | null = getGame,
): RoomSnapshot {
  let game: RoomSnapshot['game'] = null;
  if (room.game) {
    const def = lookupGame(room.game.gameType);
    if (!def) throw new Error(`game plug-in missing: ${room.game.gameType}`);
    game = {
      sessionId: room.game.sessionId,
      gameType: room.game.gameType,
      version: def.getVersion(room.game.state),
      view: def.getPlayerView(room.game.state, viewerId),
      result: room.game.result,
    };
  }
  return {
    roomId: room.roomId,
    inviteToken: room.inviteToken,
    gameType: room.gameType,
    settings: { ...room.settings },
    status: room.status,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    players: room.seats.map((s) => seatView(room, s)),
    version: room.version,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    serverTime: now,
    game,
    gamesPlayed: room.gamesPlayed,
  };
}

export function buildInvitePreview(room: LiveRoom, viewerId: string): InvitePreview {
  const host = room.seats.find((s) => s.userId === room.hostId) ?? room.seats[0];
  const alreadyMember = room.seats.some((s) => s.userId === viewerId);
  let reason: InvitePreview['reason'] = null;
  if (room.status === 'EXPIRED') reason = 'ROOM_EXPIRED';
  else if (room.status === 'CLOSED') reason = 'ROOM_CLOSED';
  else if (!alreadyMember && room.status === 'IN_GAME') reason = 'GAME_ALREADY_STARTED';
  else if (!alreadyMember && room.seats.length >= room.maxPlayers) reason = 'ROOM_FULL';
  return {
    gameType: room.gameType,
    settings: { ...room.settings },
    host: { displayName: host?.displayName ?? 'Someone', photoUrl: host?.photoUrl ?? null },
    seatsTaken: room.seats.length,
    maxPlayers: room.maxPlayers,
    status: room.status,
    joinable: reason === null && !alreadyMember,
    reason,
    alreadyMember,
    // Members already know the room id; outsiders only learn it by joining.
    roomId: alreadyMember ? room.roomId : null,
  };
}

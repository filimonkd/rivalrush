import type { GameId, GameResult, RoomSettings, RoomStatus } from '@rivalrush/shared';

/**
 * Live room state held by the RoomStore. Plain, serializable data (no sockets, no class
 * instances) so a Redis-backed store can replace the in-memory one later.
 */
export interface Seat {
  userId: string;
  displayName: string;
  photoUrl: string | null;
  ready: boolean;
  /** Open realtime connections subscribed to this room. Online = connections > 0. */
  connections: number;
  wantsRematch: boolean;
  joinedAt: number;
  lastSeenAt: number;
  /** Set while the player is offline during a live game. */
  graceDeadlineAt: number | null;
}

export interface LiveGameSession {
  sessionId: string;
  gameType: GameId;
  players: string[];
  isRematch: boolean;
  firstPlayerId: string;
  /** Raw game state. NEVER sent to clients: views are derived per player. */
  state: unknown;
  startedAt: number;
  endedAt: number | null;
  result: GameResult | null;
}

export interface LiveRoom {
  roomId: string;
  inviteToken: string;
  gameType: GameId;
  settings: RoomSettings;
  hostId: string;
  status: RoomStatus;
  maxPlayers: number;
  minPlayers: number;
  seats: Seat[];
  version: number;
  createdAt: number;
  expiresAt: number;
  game: LiveGameSession | null;
  gamesPlayed: number;
  /** Who moves first in the next game (rematches swap the starting player). */
  nextFirstPlayerId: string | null;
  /** Recently applied state-changing action keys (`userId:actionId`), newest last. */
  processedActions: string[];
  /** When a terminal room (CLOSED/EXPIRED) is removed from memory. */
  purgeAt: number | null;
}

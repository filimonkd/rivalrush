import type { AnyGameResult, GameId, RoomSettings, RoomStatus } from '@rivalrush/shared';

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

/** Who played, snapshotted at game start so a player who leaves mid-game keeps their name. */
export interface RosterEntry {
  userId: string;
  displayName: string;
  photoUrl: string | null;
}

export interface LiveGameSession {
  sessionId: string;
  gameType: GameId;
  players: string[];
  /** Same order as `players`. */
  roster: RosterEntry[];
  isRematch: boolean;
  firstPlayerId: string;
  /** Raw game state. NEVER sent to clients: views are derived per player. */
  state: unknown;
  startedAt: number;
  endedAt: number | null;
  result: AnyGameResult | null;
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
  /**
   * Who moves first in the next game: the seat after this game's starting player, in seat order
   * (2 players: they swap; 3–4 players: they rotate).
   */
  nextFirstPlayerId: string | null;
  /** Recently applied state-changing action keys (`userId:actionId`), newest last. */
  processedActions: string[];
  /** When a terminal room (CLOSED/EXPIRED) is removed from memory. */
  purgeAt: number | null;
}

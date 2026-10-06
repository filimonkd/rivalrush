import { z } from 'zod';
import type { CcMove, CcPlayerAction, CcPlayerView, CcSettings } from './colorCipher.js';
import type { CtcMove, CtcPlayerAction, CtcPlayerView, CtcSettings } from './crackTheCode.js';
import type { DefuserMove, DefuserPlayerAction, DefuserSettings } from './defuser.js';
import type { AnyGameResult } from './games.js';

/**
 * Room lifecycle (see docs/state-machine.md):
 * LOBBY ⇄ READY → IN_GAME → FINISHED → IN_GAME (rematch) …; any → EXPIRED | CLOSED.
 */
export const ROOM_STATUSES = [
  'LOBBY',
  'READY',
  'IN_GAME',
  'FINISHED',
  'EXPIRED',
  'CLOSED',
] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const TERMINAL_ROOM_STATUSES: readonly RoomStatus[] = ['EXPIRED', 'CLOSED'];

/** Every game the platform knows. Defuser is known but not playable yet (no plug-in). */
export const GAME_IDS = ['crack-the-code', 'color-cipher', 'defuser'] as const;
export type GameId = (typeof GAME_IDS)[number];

export interface PlayerSeat {
  userId: string;
  displayName: string;
  photoUrl: string | null;
  isHost: boolean;
  ready: boolean;
  online: boolean;
  wantsRematch: boolean;
  /** Epoch ms when the disconnect grace period ends, if the player is away mid-game. */
  graceDeadlineAt: number | null;
}

/** Settings of the room's game (look at `gameType` to tell them apart). */
export type RoomSettings = CtcSettings | CcSettings | DefuserSettings;

/**
 * A player's view of the running game; `view.gameId` tells the games apart.
 * `DefuserPlayerView` (defuser.ts) joins this union in the integration phase, together with
 * the plug-in that builds it; no Defuser view can be produced before then.
 */
export type GamePlayerView = CtcPlayerView | CcPlayerView;

/** One entry of a game's secret-free move log (stored in match history). */
export type GameMove = CtcMove | CcMove | DefuserMove;

/** Any player action the client can send in `game:action`. */
export type PlayerAction = CtcPlayerAction | CcPlayerAction | DefuserPlayerAction;

export interface GameSnapshot {
  sessionId: string;
  gameType: GameId;
  version: number;
  /** Player-specific view. Built per recipient; never the raw state. */
  view: GamePlayerView;
  result: AnyGameResult | null;
}

export interface RoomSnapshot {
  roomId: string;
  /** Only present for room members; the invite token is the shareable part of the link. */
  inviteToken: string;
  gameType: GameId;
  settings: RoomSettings;
  status: RoomStatus;
  hostId: string;
  maxPlayers: number;
  players: PlayerSeat[];
  version: number;
  createdAt: number;
  expiresAt: number;
  /** Server clock at snapshot time; clients derive countdowns from deadlines + this offset. */
  serverTime: number;
  game: GameSnapshot | null;
  /** Number of completed games in this room (rematches increase it). */
  gamesPlayed: number;
}

export interface InvitePreview {
  gameType: GameId;
  settings: RoomSettings;
  host: { displayName: string; photoUrl: string | null };
  seatsTaken: number;
  maxPlayers: number;
  status: RoomStatus;
  joinable: boolean;
  /** Present when joinable is false. */
  reason: 'ROOM_FULL' | 'ROOM_EXPIRED' | 'ROOM_CLOSED' | 'GAME_ALREADY_STARTED' | null;
  /** True if the viewer is already a member (they can just open the room). */
  alreadyMember: boolean;
  roomId: string | null;
}

export type RoomEventType =
  | 'player_joined'
  | 'player_left'
  | 'player_ready'
  | 'player_online'
  | 'player_offline'
  | 'host_changed'
  | 'game_started'
  | 'secret_locked'
  | 'playing_started'
  | 'guess_made'
  | 'turn_timed_out'
  | 'last_chance'
  | 'game_over'
  | 'rematch_requested'
  | 'rematch_started';

export interface RoomEvent {
  type: RoomEventType;
  roomId: string;
  version: number;
  at: number;
  /** Who caused it, if anyone. */
  actorId: string | null;
  /** Safe public payload (never secrets). */
  data?: Record<string, unknown>;
}

/** Opaque invite tokens: URL-safe, 16–64 chars. */
export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
export const roomIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
export const actionIdSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

/** Telegram start_param prefix used by invite deep links: t.me/<bot>?startapp=room_<token>. */
export const INVITE_START_PARAM_PREFIX = 'room_';

export function inviteStartParam(token: string): string {
  return `${INVITE_START_PARAM_PREFIX}${token}`;
}

export function parseInviteStartParam(startParam: string | null | undefined): string | null {
  if (!startParam || !startParam.startsWith(INVITE_START_PARAM_PREFIX)) return null;
  const token = startParam.slice(INVITE_START_PARAM_PREFIX.length);
  return inviteTokenSchema.safeParse(token).success ? token : null;
}

/** Main Mini App direct link (requires the Main Mini App to be enabled in BotFather). */
export function buildInviteLink(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?startapp=${inviteStartParam(token)}`;
}

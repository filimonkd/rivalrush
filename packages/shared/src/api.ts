import { z } from 'zod';
import type { AnyGameEndReason, CoopIndividualResult } from './games.js';
import type { GameId, RoomSnapshot } from './rooms.js';
import { actionIdSchema, inviteTokenSchema } from './rooms.js';
import type { AppErrorPayload } from './errors.js';

/** Co-op (Defuser) counters. Co-op games never touch the competitive fields. */
export interface CoopStats {
  /** Co-op games the player was in at the start. */
  played: number;
  /** Team DEFUSED while the player was active. */
  wins: number;
  /** Team DETONATED while the player was active. */
  losses: number;
  /** Games the player dropped out of (timed out without rejoining, or left). */
  dropped: number;
}

export interface UserStats {
  /** Competitive (duel) games only. */
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  currentStreak: number;
  bestStreak: number;
  coop: CoopStats;
}

export interface PublicUser {
  id: string;
  displayName: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  languageCode: string | null;
  isPremium: boolean;
  stats: UserStats;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: PublicUser;
  /** Invite token extracted from the signed start_param, if the app was opened from an invite. */
  inviteToken: string | null;
}

/** A player's result in one match: duel outcomes, or a co-op individual result. */
export type MatchOutcome = 'win' | 'loss' | 'draw' | CoopIndividualResult;

export interface MatchTeammate {
  userId: string;
  displayName: string;
  photoUrl: string | null;
  /** Starting role (Defuser: operator or analyst). */
  role: string;
}

/** Co-op part of a history row, from the viewer's point of view. Never contains game secrets. */
export interface MatchCoopSummary {
  role: string;
  /** How the viewer's role changed during the game, if it did. */
  roleChange: 'promoted' | 'rejoined' | null;
  panelsSolved: number;
  faults: number;
  msRemaining: number;
}

export interface MatchSummary {
  sessionId: string;
  roomId: string;
  gameType: GameId;
  outcome: MatchOutcome;
  reason: AnyGameEndReason;
  /** Duels: the other player. Co-op: null. */
  opponent: { userId: string; displayName: string; photoUrl: string | null } | null;
  /** Duels: the viewer's turns. Co-op: accepted Operator inputs in the whole game. */
  turns: number;
  /** Co-op: everyone else in the game. Duels: empty. */
  teammates: MatchTeammate[];
  /** Co-op only; null for duels. */
  coop: MatchCoopSummary | null;
  startedAt: string;
  endedAt: string;
}

export interface ProfileResponse {
  user: PublicUser;
  winRate: number;
  recentMatches: MatchSummary[];
}

export interface GameCatalogEntry {
  id: string;
  name: string;
  tagline: string;
  status: 'live' | 'coming_soon';
  minPlayers: number;
  maxPlayers: number;
}

export interface ActiveRoomResponse {
  room: RoomSnapshot | null;
}

export type RoomStateResponse =
  { changed: false; version: number } | { changed: true; room: RoomSnapshot };

export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  version: string;
  database: 'up' | 'down';
}

export type ApiErrorResponse = { error: AppErrorPayload };

// ---- request schemas (validated server-side; reused by the client for typing) ----

export const telegramAuthRequestSchema = z
  .object({
    initData: z.string().min(1).max(8192),
  })
  .strict();

export const devAuthRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .regex(/^[\p{L}\p{N} _.-]+$/u),
  })
  .strict();

export const createRoomRequestSchema = z
  .object({
    gameType: z.string().min(1).max(64),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const joinRoomRequestSchema = z
  .object({
    inviteToken: inviteTokenSchema,
  })
  .strict();

export const roomCommandRequestSchema = z
  .object({
    actionId: actionIdSchema.optional(),
  })
  .strict();

export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;
export type JoinRoomRequest = z.infer<typeof joinRoomRequestSchema>;

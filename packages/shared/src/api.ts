import { z } from 'zod';
import type { CtcEndReason } from './crackTheCode.js';
import type { GameId, RoomSnapshot } from './rooms.js';
import { actionIdSchema, inviteTokenSchema } from './rooms.js';
import type { AppErrorPayload } from './errors.js';

export interface UserStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  currentStreak: number;
  bestStreak: number;
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

export type MatchOutcome = 'win' | 'loss' | 'draw';

export interface MatchSummary {
  sessionId: string;
  roomId: string;
  gameType: GameId;
  outcome: MatchOutcome;
  reason: CtcEndReason;
  opponent: { userId: string; displayName: string; photoUrl: string | null } | null;
  turns: number;
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

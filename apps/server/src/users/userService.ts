import { createHash } from 'node:crypto';
import type { MatchSummary, ProfileResponse, PublicUser, UserStats } from '@rivalrush/shared';
import { isValidObjectId } from 'mongoose';
import type { TelegramUser } from '../auth/telegramAuth.js';
import { AppError } from '../errors.js';
import { MatchModel } from '../matches/Match.model.js';
import { UserModel, type UserDoc } from './User.model.js';

export interface SeatIdentity {
  userId: string;
  displayName: string;
  photoUrl: string | null;
}

function displayNameOf(first: string, last?: string | null, username?: string | null): string {
  const full = [first, last].filter(Boolean).join(' ').trim();
  return (full || username || 'Player').slice(0, 64);
}

/** Only https Telegram-hosted avatars are passed to the client. */
function safePhotoUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function upsertTelegramUser(tg: TelegramUser, viaInvite: boolean): Promise<UserDoc> {
  const user = await UserModel.findOneAndUpdate(
    { telegramId: tg.id },
    {
      $set: {
        username: tg.username ?? null,
        firstName: tg.first_name,
        lastName: tg.last_name ?? null,
        displayName: displayNameOf(tg.first_name, tg.last_name, tg.username),
        photoUrl: safePhotoUrl(tg.photo_url),
        languageCode: tg.language_code ?? null,
        isPremium: tg.is_premium === true,
        lastSeenAt: new Date(),
      },
      $setOnInsert: { telegramId: tg.id, isDev: false, 'acquisition.viaInvite': viaInvite },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return user!;
}

/** Development-only users (negative telegramId so they can never collide with real ones). */
export async function upsertDevUser(name: string): Promise<UserDoc> {
  const digest = createHash('sha256').update(name.toLowerCase()).digest();
  const telegramId = -(digest.readUIntBE(0, 6) + 1);
  const user = await UserModel.findOneAndUpdate(
    { telegramId },
    {
      $set: { firstName: name, displayName: name, lastSeenAt: new Date() },
      $setOnInsert: { telegramId, isDev: true },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return user!;
}

export async function getUser(userId: string): Promise<UserDoc> {
  if (!isValidObjectId(userId)) throw new AppError('UNAUTHORIZED');
  const user = await UserModel.findById(userId);
  if (!user) throw new AppError('UNAUTHORIZED');
  return user;
}

export function toStats(user: UserDoc): UserStats {
  const s = user.stats ?? {};
  return {
    gamesPlayed: s.gamesPlayed ?? 0,
    wins: s.wins ?? 0,
    losses: s.losses ?? 0,
    draws: s.draws ?? 0,
    currentStreak: s.currentStreak ?? 0,
    bestStreak: s.bestStreak ?? 0,
  };
}

export function toPublicUser(user: UserDoc): PublicUser {
  return {
    id: user.id as string,
    displayName: user.displayName,
    username: user.username ?? null,
    firstName: user.firstName,
    lastName: user.lastName ?? null,
    photoUrl: user.photoUrl ?? null,
    languageCode: user.languageCode ?? null,
    isPremium: user.isPremium ?? false,
    stats: toStats(user),
    createdAt: (user.get('createdAt') as Date).toISOString(),
  };
}

export function toSeatIdentity(user: UserDoc): SeatIdentity {
  return {
    userId: user.id as string,
    displayName: user.displayName,
    photoUrl: user.photoUrl ?? null,
  };
}

export function winRate(stats: UserStats): number {
  return stats.gamesPlayed === 0 ? 0 : Math.round((stats.wins / stats.gamesPlayed) * 1000) / 10;
}

export async function recentMatches(userId: string, limit = 10): Promise<MatchSummary[]> {
  const docs = await MatchModel.find({ 'players.userId': userId })
    .sort({ endedAt: -1 })
    .limit(limit)
    .lean();
  return docs.map((m) => {
    const me = m.players.find((p) => String(p.userId) === userId)!;
    const opp = m.players.find((p) => String(p.userId) !== userId);
    return {
      sessionId: m.sessionId,
      roomId: m.roomId,
      gameType: m.gameType as MatchSummary['gameType'],
      outcome: me.outcome as MatchSummary['outcome'],
      reason: m.result?.reason as MatchSummary['reason'],
      opponent: opp
        ? {
            userId: String(opp.userId),
            displayName: opp.displayName,
            photoUrl: opp.photoUrl ?? null,
          }
        : null,
      turns: me.turns,
      startedAt: m.startedAt.toISOString(),
      endedAt: m.endedAt.toISOString(),
    };
  });
}

export async function getProfile(userId: string): Promise<ProfileResponse> {
  if (!isValidObjectId(userId)) throw new AppError('NOT_FOUND');
  const user = await UserModel.findById(userId);
  if (!user) throw new AppError('NOT_FOUND');
  const pub = toPublicUser(user);
  return { user: pub, winRate: winRate(pub.stats), recentMatches: await recentMatches(userId) };
}

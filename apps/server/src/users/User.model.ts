import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const statsSchema = new Schema(
  {
    gamesPlayed: { type: Number, default: 0, min: 0 },
    wins: { type: Number, default: 0, min: 0 },
    losses: { type: Number, default: 0, min: 0 },
    draws: { type: Number, default: 0, min: 0 },
    currentStreak: { type: Number, default: 0, min: 0 },
    bestStreak: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    /** Telegram user id. Negative ids are reserved for development-only users. */
    telegramId: { type: Number, required: true },
    username: { type: String, default: null },
    firstName: { type: String, required: true },
    lastName: { type: String, default: null },
    displayName: { type: String, required: true },
    photoUrl: { type: String, default: null },
    languageCode: { type: String, default: null },
    isPremium: { type: Boolean, default: false },
    isDev: { type: Boolean, default: false },
    stats: { type: statsSchema, default: () => ({}) },
    /** Growth metric: did the first launch come from an invite link? */
    acquisition: {
      viaInvite: { type: Boolean, default: false },
    },
    lastSeenAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true, collection: 'users' },
);

userSchema.index({ telegramId: 1 }, { unique: true });
userSchema.index({ 'stats.wins': -1 });

export type UserRecord = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserRecord>;
export const UserModel = model('User', userSchema);

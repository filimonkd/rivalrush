import { Schema, model } from 'mongoose';

/**
 * One document per game session that started (beta metric "games started"). A session that
 * started but has no `matches` document never finished: abandoned mid-way, still running, or
 * lost to a restart. Metadata only: no players' names, moves, secrets or seeds.
 */
const gameStartSchema = new Schema(
  {
    sessionId: { type: String, required: true },
    roomId: { type: String, required: true },
    gameType: { type: String, required: true },
    isRematch: { type: Boolean, default: false },
    /** Seated players when the game started. */
    players: { type: Number, required: true },
    startedAt: { type: Date, required: true },
  },
  { collection: 'game_starts' },
);

gameStartSchema.index({ sessionId: 1 }, { unique: true });
gameStartSchema.index({ startedAt: -1 });

export const GameStartModel = model('GameStart', gameStartSchema);

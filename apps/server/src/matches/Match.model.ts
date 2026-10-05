import { Schema, Types, model, type InferSchemaType } from 'mongoose';

/**
 * Finished match history for every game. Written once per game session (sessionId is unique).
 * Secret codes and patterns are never stored: only guesses, feedback counts and the result.
 */
const moveSchema = new Schema(
  {
    playerId: { type: String, required: true },
    guess: { type: String, default: null },
    // Feedback counts; which pair is present depends on the game (gameType on the match).
    /** Crack the Code: right digit right place / wrong place. */
    bulls: { type: Number },
    cows: { type: Number },
    /** Color Cipher: right color right position / wrong position. */
    exact: { type: Number },
    partial: { type: Number },
    timedOut: { type: Boolean, required: true },
    turnNumber: { type: Number, required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const matchPlayerSchema = new Schema(
  {
    userId: { type: Types.ObjectId, required: true, ref: 'User' },
    displayName: { type: String, required: true },
    photoUrl: { type: String, default: null },
    outcome: { type: String, enum: ['win', 'loss', 'draw'], required: true },
    turns: { type: Number, required: true },
  },
  { _id: false },
);

const matchSchema = new Schema(
  {
    sessionId: { type: String, required: true },
    roomId: { type: String, required: true },
    gameType: { type: String, required: true },
    settings: { type: Schema.Types.Mixed, required: true },
    isRematch: { type: Boolean, default: false },
    players: { type: [matchPlayerSchema], required: true },
    result: {
      outcome: { type: String, enum: ['win', 'draw'], required: true },
      winnerId: { type: String, default: null },
      reason: { type: String, required: true },
    },
    moves: { type: [moveSchema], default: [] },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'matches' },
);

matchSchema.index({ sessionId: 1 }, { unique: true });
matchSchema.index({ 'players.userId': 1, endedAt: -1 });
matchSchema.index({ roomId: 1, endedAt: -1 });

export type MatchRecord = InferSchemaType<typeof matchSchema>;
export const MatchModel = model('Match', matchSchema);

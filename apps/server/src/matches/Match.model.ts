import { Schema, Types, model, type InferSchemaType } from 'mongoose';

/**
 * Finished match history for every game. Written once per game session (sessionId is unique).
 * Secret codes and patterns are never stored: only guesses, feedback counts and the result.
 * Defuser stores positions and levels the Operator chose, never the Codebook or the Charge.
 */

/** Defuser moves carry a `kind`; duel moves never do. */
function isDuelMove(this: { kind?: unknown }): boolean {
  return this.kind === undefined || this.kind === null;
}

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
    timedOut: { type: Boolean, required: isDuelMove },
    turnNumber: { type: Number, required: isDuelMove },
    /** Defuser: 'input' (an accepted Operator input) or 'system' (drop-out, promotion, rejoin). */
    kind: { type: String, enum: ['input', 'system'] },
    panel: { type: String, enum: ['fuse', 'glyph', 'valve'] },
    /** Defuser: `{line}`, `{key}` or `{level, vent}`: positions and levels only. */
    input: { type: Schema.Types.Mixed },
    ok: { type: Boolean },
    event: { type: String, enum: ['timed_out', 'left', 'promoted', 'rejoined'] },
    /** Defuser: ms since the Charge was armed. */
    atMs: { type: Number },
    at: { type: Date, required: true },
  },
  { _id: false },
);

/** Co-op games: roles and final status for history (from the game's own state). */
const coopPlayerSchema = new Schema(
  {
    startRole: { type: String, required: true },
    finalRole: { type: String, required: true },
    letter: { type: String, default: null },
    finalStatus: { type: String, enum: ['active', 'timed_out', 'left'], required: true },
    rejoined: { type: Boolean, required: true },
  },
  { _id: false },
);

const MATCH_OUTCOMES = [
  'win',
  'loss',
  'draw',
  'coop_win',
  'coop_loss',
  'coop_unfinished',
  'coop_dropped',
] as const;

const matchPlayerSchema = new Schema(
  {
    userId: { type: Types.ObjectId, required: true, ref: 'User' },
    displayName: { type: String, required: true },
    photoUrl: { type: String, default: null },
    outcome: { type: String, enum: MATCH_OUTCOMES, required: true },
    turns: { type: Number, required: true },
    coop: { type: coopPlayerSchema, default: undefined },
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
      /** Absent for duels; 'coop' for co-op games. */
      kind: { type: String, enum: ['coop'] },
      outcome: {
        type: String,
        enum: ['win', 'draw', 'defused', 'detonated', 'abandoned'],
        required: true,
      },
      winnerId: { type: String, default: null },
      reason: { type: String, required: true },
      panelsSolved: { type: Number },
      faults: { type: Number },
      msRemaining: { type: Number },
    },
    /**
     * Generated-puzzle games: what regenerates the puzzle for debugging. Server-only: excluded
     * from every query by default and never mapped into an API response.
     */
    generator: {
      type: new Schema(
        { version: { type: Number, required: true }, seed: { type: String, required: true } },
        { _id: false },
      ),
      select: false,
      default: undefined,
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

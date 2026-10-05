import { Schema, model } from 'mongoose';

/**
 * Persistent room *metadata* for analytics and auditing (invite → join rate, lifecycle).
 * This is NOT the live game state: the in-memory RoomStore is authoritative for that.
 * The invite token itself is stored only as a SHA-256 hash.
 */
const roomSchema = new Schema(
  {
    roomId: { type: String, required: true },
    inviteTokenHash: { type: String, required: true },
    gameType: { type: String, required: true },
    settings: { type: Schema.Types.Mixed, required: true },
    hostId: { type: String, required: true },
    playerIds: { type: [String], default: [] },
    /** Highest number of seated players ever (2 = the invite worked). */
    peakPlayers: { type: Number, default: 1 },
    status: { type: String, required: true },
    gamesPlayed: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    /** Documents are purged by a TTL index some time after the room expires. */
    purgeAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'rooms' },
);

roomSchema.index({ roomId: 1 }, { unique: true });
roomSchema.index({ inviteTokenHash: 1 }, { unique: true });
roomSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
roomSchema.index({ createdAt: -1 });

export const RoomModel = model('Room', roomSchema);

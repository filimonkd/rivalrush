/** Game-neutral result types shared by every game plug-in, match history and stats. */

export type GameEndReason = 'cracked' | 'both_cracked' | 'out_of_guesses' | 'forfeit' | 'abandoned';

export interface GameResult {
  outcome: 'win' | 'draw';
  winnerId: string | null;
  reason: GameEndReason;
}

/** Game-neutral result types shared by every game plug-in, match history and stats. */

/** Why a duel (Crack the Code, Color Cipher) ended. */
export type GameEndReason = 'cracked' | 'both_cracked' | 'out_of_guesses' | 'forfeit' | 'abandoned';

/** The result of a duel. Unchanged since the first game; duels never carry a `kind`. */
export interface GameResult {
  outcome: 'win' | 'draw';
  winnerId: string | null;
  reason: GameEndReason;
}

/**
 * Why a co-op game (Defuser) ended. `abandoned` here means the TEAM result ABANDONED: fewer than
 * two active players remained (docs/defuser.md, Terms).
 */
export type CoopEndReason = 'defused' | 'faults' | 'timer' | 'abandoned';

/** Team result of a co-op game. Only `detonated` is a loss; `abandoned` is a no contest. */
export type CoopTeamOutcome = 'defused' | 'detonated' | 'abandoned';

/** One player's result in a co-op game (docs/defuser.md section 13). */
export const COOP_INDIVIDUAL_RESULTS = [
  'coop_win',
  'coop_loss',
  'coop_unfinished',
  'coop_dropped',
] as const;
export type CoopIndividualResult = (typeof COOP_INDIVIDUAL_RESULTS)[number];

export interface CoopResult {
  kind: 'coop';
  outcome: CoopTeamOutcome;
  reason: CoopEndReason;
  /** Panels solved when the game ended (0–3 for Defuser). */
  panelsSolved: number;
  faults: number;
  /** Countdown time left at the end, in ms (0 when the countdown ran out). */
  msRemaining: number;
  /** Every player in the game at the start, by user id. */
  individual: Record<string, CoopIndividualResult>;
}

/** Any game's result. Duel results have no `kind`; co-op results have `kind: 'coop'`. */
export type AnyGameResult = GameResult | CoopResult;

/** Any game's end reason. */
export type AnyGameEndReason = GameEndReason | CoopEndReason;

export function isCoopResult(result: AnyGameResult): result is CoopResult {
  return 'kind' in result && result.kind === 'coop';
}

/** How a player finished a co-op game: still playing, timed out (still seated), or left. */
export type CoopPlayerStatus = 'active' | 'timed_out' | 'left';

/**
 * What a co-op game reports about each player for match history, snapshotted from the game's
 * own state when it ends. Roles and letters are game-defined strings (Defuser: operator/analyst,
 * A–D) so the platform stays game-neutral.
 */
export interface CoopPlayerRecord {
  startRole: string;
  finalRole: string;
  letter: string | null;
  finalStatus: CoopPlayerStatus;
  /** True if the player timed out and came back with REJOIN. */
  rejoined: boolean;
}

/**
 * The individual result for one player, given the team outcome and whether the player was
 * active at the end. Dropping out (timed out without rejoining, or left) never earns a defuse.
 */
export function coopIndividualResult(
  teamOutcome: CoopTeamOutcome,
  activeAtEnd: boolean,
): CoopIndividualResult {
  if (!activeAtEnd) return 'coop_dropped';
  if (teamOutcome === 'defused') return 'coop_win';
  if (teamOutcome === 'detonated') return 'coop_loss';
  return 'coop_unfinished';
}

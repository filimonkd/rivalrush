import {
  PANEL_IDS,
  coopIndividualResult,
  defuserCountdownSeconds,
  type CoopEndReason,
  type CoopIndividualResult,
  type CoopTeamOutcome,
} from '@rivalrush/shared';
import type { GameEvent } from '../engine/types.js';
import { isActive, type DefuserState } from './state.js';

/** BRIEFING → ARMED (spec section 8). The countdown is fixed by the Analysts at game start. */
export function arm(s: DefuserState, at: number, events: GameEvent[]): void {
  s.phase = 'ARMED';
  s.briefingDeadlineAt = null;
  s.armedAt = at;
  s.deadlineAt = at + defuserCountdownSeconds(s.analystCount) * 1000;
  events.push({ type: 'device_armed', actorId: null, data: { deadlineAt: s.deadlineAt } });
}

const OUTCOME: Record<CoopEndReason, CoopTeamOutcome> = {
  defused: 'defused',
  faults: 'detonated',
  timer: 'detonated',
  abandoned: 'abandoned',
};

/** Ends the game with the team result and every player's individual result (section 13). */
export function endGame(
  s: DefuserState,
  reason: CoopEndReason,
  now: number,
  events: GameEvent[],
): void {
  const outcome = OUTCOME[reason];
  const individual: Record<string, CoopIndividualResult> = {};
  for (const p of s.players) individual[p.id] = coopIndividualResult(outcome, isActive(p));
  const countdownMs = defuserCountdownSeconds(s.analystCount) * 1000;
  // Before arming nothing of the countdown was used; at the deadline nothing is left.
  const msRemaining =
    s.deadlineAt === null ? countdownMs : reason === 'timer' ? 0 : Math.max(0, s.deadlineAt - now);
  s.phase = reason === 'defused' ? 'DEFUSED' : reason === 'abandoned' ? 'ABANDONED' : 'DETONATED';
  s.result = {
    kind: 'coop',
    outcome,
    reason,
    panelsSolved: PANEL_IDS.filter((p) => s.solved[p]).length,
    faults: s.faults,
    msRemaining,
    individual,
  };
  s.briefingDeadlineAt = null;
  s.endedAt = now;
  s.litKey = null;
  events.push({ type: 'game_over', actorId: null, data: { reason } });
}

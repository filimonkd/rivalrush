import type { ErrorCode, MatchOutcome } from '@rivalrush/shared';

export { reasonLabel } from './games';

const OUTCOME_LABELS: Record<MatchOutcome, string> = {
  win: 'Win',
  loss: 'Loss',
  draw: 'Draw',
  coop_win: 'Defused',
  coop_loss: 'Detonated',
  coop_unfinished: 'Unfinished',
  coop_dropped: 'Dropped out',
};

export function outcomeLabel(outcome: MatchOutcome): string {
  return OUTCOME_LABELS[outcome];
}

const JOIN_ERRORS: Partial<Record<ErrorCode | 'NETWORK_ERROR', string>> = {
  ROOM_NOT_FOUND: "This invite link doesn't work anymore.",
  ROOM_EXPIRED: 'This room expired. Ask your friend for a new invite.',
  ROOM_CLOSED: 'This room has closed. Ask your friend for a new invite.',
  ROOM_FULL: 'Someone already took this seat.',
  GAME_ALREADY_STARTED: 'This game has already started.',
};

export function joinErrorMessage(code: string, fallback: string): string {
  return JOIN_ERRORS[code as ErrorCode] ?? fallback;
}

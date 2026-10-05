import type { CtcEndReason, ErrorCode } from '@rivalrush/shared';

export function reasonLabel(reason: CtcEndReason): string {
  switch (reason) {
    case 'cracked':
      return 'Code cracked';
    case 'both_cracked':
      return 'Both cracked it — draw';
    case 'out_of_guesses':
      return 'Out of guesses — draw';
    case 'forfeit':
      return 'Gave up';
    case 'abandoned':
      return 'Dropped out';
  }
}

export function outcomeLabel(outcome: 'win' | 'loss' | 'draw'): string {
  return outcome === 'win' ? 'Win' : outcome === 'loss' ? 'Loss' : 'Draw';
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

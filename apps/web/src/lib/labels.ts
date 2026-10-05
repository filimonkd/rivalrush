import type { ErrorCode } from '@rivalrush/shared';

export { reasonLabel } from './games';

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

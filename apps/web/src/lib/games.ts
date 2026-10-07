import {
  COLOR_CIPHER_ID,
  CRACK_THE_CODE_ID,
  DEFUSER_ID,
  type AnyGameEndReason,
  type GameId,
  type RoomSettings,
} from '@rivalrush/shared';

/** What the web app needs to know about each playable game (rules live on the server). */
export interface GameInfo {
  id: GameId;
  name: string;
  tagline: string;
  /** Short line under the name on the create screen. */
  blurb: string;
  /** Co-op games (Defuser) say "teammates" and "team" instead of "opponent". */
  coop?: boolean;
  /** What the secret is called in the UI ("code", "pattern"). */
  secretNoun: string;
  /** Settings shown as tiles on the invite preview and in the lobby. */
  summary(settings: RoomSettings): Array<{ value: string; label: string }>;
}

const num = (settings: RoomSettings, key: string): number =>
  Number((settings as unknown as Record<string, unknown>)[key] ?? 0);

export const GAMES: Record<GameId, GameInfo> = {
  [CRACK_THE_CODE_ID]: {
    id: CRACK_THE_CODE_ID,
    name: 'Crack the Code',
    tagline: 'Hide a code. Crack theirs first.',
    blurb: '2 players · hide a code, crack theirs first',
    secretNoun: 'code',
    summary: (s) => [
      { value: String(num(s, 'codeLength')), label: 'digits' },
      { value: `${num(s, 'turnSeconds')}s`, label: 'per turn' },
      { value: String(num(s, 'maxGuesses')), label: 'guesses' },
    ],
  },
  [COLOR_CIPHER_ID]: {
    id: COLOR_CIPHER_ID,
    name: 'Color Cipher',
    tagline: 'Hide a color pattern. Crack theirs first.',
    blurb: '2 players · hide a color pattern, crack theirs first',
    secretNoun: 'pattern',
    summary: (s) => [
      { value: `${num(s, 'patternLength')}×${num(s, 'colorCount')}`, label: 'tiles × colors' },
      { value: `${num(s, 'turnSeconds')}s`, label: 'per turn' },
      { value: String(num(s, 'maxGuesses')), label: 'guesses' },
    ],
  },
  // Co-op. Playable only where the server registers it (dev/test); never offered on Home.
  [DEFUSER_ID]: {
    id: DEFUSER_ID,
    name: 'Defuser',
    tagline: 'Your crew vs. the clock.',
    blurb: 'Co-op · 2–4 players · best on a voice call',
    coop: true,
    secretNoun: 'Charge',
    summary: () => [
      { value: '2–4', label: 'players' },
      { value: '~5 min', label: 'per game' },
      { value: 'Co-op', label: 'voice call' },
    ],
  },
};

export function gameInfo(id: string): GameInfo {
  return GAMES[id as GameId] ?? GAMES[CRACK_THE_CODE_ID];
}

export function reasonLabel(
  reason: AnyGameEndReason,
  gameType: string = CRACK_THE_CODE_ID,
): string {
  switch (reason) {
    case 'cracked':
      return gameType === COLOR_CIPHER_ID ? 'Pattern cracked' : 'Code cracked';
    case 'both_cracked':
      return 'Both cracked it — draw';
    case 'out_of_guesses':
      return 'Out of guesses — draw';
    case 'forfeit':
      return 'Gave up';
    case 'abandoned':
      return gameType === DEFUSER_ID ? 'Not enough players' : 'Dropped out';
    case 'defused':
      return 'Defused';
    case 'faults':
      return '3 faults';
    case 'timer':
      return 'Time ran out';
  }
}

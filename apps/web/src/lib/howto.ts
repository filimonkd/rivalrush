import {
  CC_LIMITS,
  COLOR_CIPHER_ID,
  CRACK_THE_CODE_ID,
  CTC_LIMITS,
  DEFUSER_ID,
  type GameId,
} from '@rivalrush/shared';
import { DEFUSER_HOW_TO_STEPS } from '../features/defuser/howto';

/**
 * How to play, per game: a few short, skippable steps shown once per device in the lobby and
 * on demand. Plain words, the room's own numbers where they vary, and only examples that the
 * rules docs and server tests already check (docs/game-rules.md, docs/color-cipher.md).
 */
export interface HowToStep {
  title: string;
  lines: string[];
}

export interface HowTo {
  steps(settings?: Record<string, unknown>): readonly HowToStep[];
  /** Defuser keeps its amber; the duels use the theme accent. */
  tone: 'defuser' | 'duel';
}

const n = (s: Record<string, unknown> | undefined, key: string, fallback: number): number => {
  const v = s?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

/** Turns, the guess limit and endings are the same in both duels. */
function duelEnd(s: Record<string, unknown> | undefined, noun: string): HowToStep[] {
  const turn = n(s, 'turnSeconds', CTC_LIMITS.turnSeconds.default);
  const guesses = n(s, 'maxGuesses', CTC_LIMITS.maxGuesses.default);
  return [
    {
      title: 'Turns and guesses',
      lines: [
        `You get ${turn} seconds per turn. If the time runs out, that turn is used up.`,
        `Each of you has ${guesses} turns, timed-out ones included.`,
        'Repeating one of your own guesses isn’t allowed, and it doesn’t use up your turn.',
      ],
    },
    {
      title: 'How it ends',
      lines: [
        `Going first is no advantage: if the first player cracks the ${noun}, the other gets one last guess. Crack it too and it’s a draw.`,
        'Nobody cracks it before the turns run out: a draw.',
        'Give up, leave, or stay away for more than 60 seconds: you lose.',
        'In a rematch the other player goes first.',
      ],
    },
  ];
}

const HOW_TO: Record<GameId, HowTo> = {
  [CRACK_THE_CODE_ID]: {
    tone: 'duel',
    steps: (s) => [
      {
        title: 'Hide a code, crack theirs',
        lines: [
          `You each hide a secret code: ${n(s, 'codeLength', CTC_LIMITS.codeLength.default)} digits from 0–9, no digit twice (a leading 0 is fine).`,
          'Then take turns guessing each other’s code. First to crack it wins.',
          'Lock yours in within 60 seconds, or one is picked for you.',
        ],
      },
      {
        title: 'Reading the clues',
        lines: [
          '● Bull: a right digit in the right place.',
          '○ Cow: a right digit in the wrong place.',
          'Example: the code is 5831 and you guess 5813. 5 and 8 are in place: 2 bulls. 1 and 3 are in the code but swapped: 2 cows.',
          'Clues are only counts: they never say which digits. Use each guess to rule digits in or out.',
        ],
      },
      ...duelEnd(s, 'code'),
    ],
  },
  [COLOR_CIPHER_ID]: {
    tone: 'duel',
    steps: (s) => [
      {
        title: 'Hide a pattern, crack theirs',
        lines: [
          `You each hide a pattern of ${CC_LIMITS.patternLength} tiles. Each tile is one of ${CC_LIMITS.colorCount} colors, and colors can repeat.`,
          'Every color also has its own symbol, so you never have to tell shades apart.',
          'Then take turns guessing each other’s pattern. First to crack it wins. Lock yours in within 60 seconds, or one is picked for you.',
        ],
      },
      {
        title: 'Reading the clues',
        lines: [
          '◆ Exact: a right color in the right spot.',
          '◇ Close: a right color in the wrong spot.',
          'Each hidden tile counts once. Example: the pattern is Ruby Ruby Sun Amber and you guess four Rubies: 2 Exact, 0 Close. There are only two Rubies, and both are in place.',
          'Clues are only counts: they never say which tiles.',
        ],
      },
      ...duelEnd(s, 'pattern'),
    ],
  },
  [DEFUSER_ID]: {
    tone: 'defuser',
    steps: () => DEFUSER_HOW_TO_STEPS,
  },
};

export function howToFor(gameId: string): HowTo {
  return HOW_TO[gameId as GameId] ?? HOW_TO[CRACK_THE_CODE_ID];
}

/** Storage keys per game; `rr.defuser.howToSeen` predates the duels and keeps its name. */
const seenKey = (gameId: string) => `rr.${gameId}.howToSeen`;

/** Whether this device has already seen (or skipped) the game's explainer. */
export function seenHowTo(gameId: string): boolean {
  try {
    return localStorage.getItem(seenKey(gameId)) === '1';
  } catch {
    return false;
  }
}

export function markHowToSeen(gameId: string): void {
  try {
    localStorage.setItem(seenKey(gameId), '1');
  } catch {
    /* storage unavailable: it will show again next time, which is harmless */
  }
}

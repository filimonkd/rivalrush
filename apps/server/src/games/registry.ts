import type { GameCatalogEntry } from '@rivalrush/shared';
import { crackTheCode } from './crack-the-code/game.js';
import type { AnyGameDefinition } from './engine/types.js';

/** Playable games. Adding a game = adding its plug-in here. */
const LIVE_GAMES: Record<string, AnyGameDefinition> = {
  [crackTheCode.id]: crackTheCode,
};

const CATALOG: GameCatalogEntry[] = [
  {
    id: 'crack-the-code',
    name: 'Crack the Code',
    tagline: 'Hide a code. Crack theirs first.',
    status: 'live',
    minPlayers: 2,
    maxPlayers: 2,
  },
  {
    id: 'color-cipher',
    name: 'Color Cipher',
    tagline: 'A color code duel.',
    status: 'coming_soon',
    minPlayers: 2,
    maxPlayers: 2,
  },
  {
    id: 'defuser',
    name: 'Defuser',
    tagline: 'One sees the device. The others hold the manual.',
    status: 'coming_soon',
    minPlayers: 2,
    maxPlayers: 4,
  },
];

export function getGame(id: string): AnyGameDefinition | null {
  return Object.hasOwn(LIVE_GAMES, id) ? LIVE_GAMES[id]! : null;
}

export function listGames(): GameCatalogEntry[] {
  return CATALOG.map((g) => ({ ...g }));
}

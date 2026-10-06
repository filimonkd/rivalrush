import type { GameCatalogEntry } from '@rivalrush/shared';
import { colorCipher } from './color-cipher/game.js';
import { crackTheCode } from './crack-the-code/game.js';
import type { AnyGameDefinition } from './engine/types.js';

/**
 * Playable games. Adding a game = adding its plug-in here.
 *
 * Defuser is deliberately NOT here yet: its server plug-in exists (games/defuser/game.ts) but
 * it has no UI (docs/defuser.md, "Implementation status"). Creating a Defuser room therefore
 * fails with GAME_NOT_AVAILABLE, and the catalog keeps it `coming_soon`. Tests reach the
 * plug-in through RoomManager's injectable `games` lookup.
 */
const LIVE_GAMES: Record<string, AnyGameDefinition> = {
  [crackTheCode.id]: crackTheCode,
  [colorCipher.id]: colorCipher,
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
    tagline: 'Hide a color pattern. Crack theirs first.',
    status: 'live',
    minPlayers: 2,
    maxPlayers: 2,
  },
  {
    id: 'defuser',
    name: 'Defuser',
    tagline: 'Your crew vs. the clock.',
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

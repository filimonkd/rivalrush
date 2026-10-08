import { DEFUSER_ID, type GameCatalogEntry } from '@rivalrush/shared';
import { colorCipher } from './color-cipher/game.js';
import { crackTheCode } from './crack-the-code/game.js';
import { createDefuser, defuser } from './defuser/game.js';
import type { AnyGameDefinition } from './engine/types.js';

/** The duels: always registered. */
const DUELS: Record<string, AnyGameDefinition> = {
  [crackTheCode.id]: crackTheCode,
  [colorCipher.id]: colorCipher,
};

export interface GameRegistryOptions {
  /**
   * Registers Defuser (docs/defuser.md). Off unless explicitly enabled: in development and test
   * (tests and E2E create Defuser rooms explicitly), on staging (listed as `preview`) and on the
   * live service, where enabling it releases it to everyone (listed as `live`).
   */
  defuserEnabled?: boolean;
  /** Dev/test only: every Defuser game uses this 128-bit seed. Refused in production and staging. */
  defuserFixedSeed?: string | null;
  isProduction?: boolean;
  /** A production-hardened staging deployment: Defuser is a `preview` there, not `live`. */
  isStaging?: boolean;
}

export interface GameRegistry {
  get(id: string): AnyGameDefinition | null;
  list(): GameCatalogEntry[];
}

/**
 * Builds the set of games this server can run. Adding a game = adding its plug-in here.
 *
 * Defuser is registered only when explicitly enabled. Its catalog status follows the deployment:
 * `live` on the live service (released: Home offers it to everyone), `preview` on staging, and
 * `coming_soon` in development and test or when it is not registered. With it unregistered,
 * creating a Defuser room fails with GAME_NOT_AVAILABLE.
 */
export function createGameRegistry(opts: GameRegistryOptions = {}): GameRegistry {
  const wantsDefuser = opts.defuserEnabled === true;
  const fixedSeed = opts.defuserFixedSeed ?? undefined;
  if (opts.isProduction && fixedSeed) {
    throw new Error('A fixed Defuser seed is not available in production (or staging)');
  }
  const status: GameCatalogEntry['status'] | null =
    wantsDefuser && opts.isProduction ? (opts.isStaging ? 'preview' : 'live') : null;
  const games: Record<string, AnyGameDefinition> = { ...DUELS };
  if (wantsDefuser) {
    // Without a fixed seed, every game seeds itself from the platform's CSPRNG-backed random().
    games[DEFUSER_ID] = fixedSeed ? createDefuser({ fixedSeed }) : defuser;
  }
  return {
    get: (id) => (Object.hasOwn(games, id) ? games[id]! : null),
    list: () => CATALOG.map((g) => (status && g.id === DEFUSER_ID ? { ...g, status } : { ...g })),
  };
}

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

/** The production-safe default: the duels only. */
const defaultRegistry = createGameRegistry();

export function getGame(id: string): AnyGameDefinition | null {
  return defaultRegistry.get(id);
}

export function listGames(): GameCatalogEntry[] {
  return defaultRegistry.list();
}

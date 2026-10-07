// @vitest-environment jsdom
import type { GameCatalogEntry, MatchSummary } from '@rivalrush/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let games: GameCatalogEntry[] = [];
let recent: MatchSummary[] = [];
vi.mock('../src/lib/api', () => ({
  api: vi.fn(async (path: string) => {
    if (path === '/games') return { games };
    if (path.startsWith('/me/matches')) return { matches: recent };
    if (path === '/me/active-room') return { room: null };
    throw new Error(`unexpected ${path}`);
  }),
  ApiError: class extends Error {},
  setAuthToken: () => undefined,
}));

const { HomePage } = await import('../src/pages/HomePage');
const { useSession } = await import('../src/store/session');

const entry = (id: string, status: GameCatalogEntry['status']): GameCatalogEntry => ({
  id,
  name: id === 'defuser' ? 'Defuser' : id,
  tagline: 'Your crew vs. the clock.',
  status,
  minPlayers: 2,
  maxPlayers: id === 'defuser' ? 4 : 2,
});

beforeEach(() => {
  recent = [];
  useSession.setState({
    status: 'ready',
    user: {
      id: 'u1',
      displayName: 'Ivy',
      stats: {
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        currentStreak: 0,
        bestStreak: 0,
        coop: { played: 1, wins: 1, losses: 0, dropped: 0 },
      },
    } as never,
    refreshMe: async () => undefined,
  });
});
afterEach(cleanup);

const home = () =>
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );

describe('Home and unreleased games', () => {
  it('live (coming_soon): Defuser has no start button, only the Coming soon tile', async () => {
    games = [entry('crack-the-code', 'live'), entry('defuser', 'coming_soon')];
    home();
    expect(await screen.findByText('Coming soon')).toBeTruthy();
    expect(screen.queryByTestId('start-preview-defuser')).toBeNull();
  });

  it('staging (preview): a clearly labelled start card opens the team-game create page', async () => {
    games = [entry('crack-the-code', 'live'), entry('defuser', 'preview')];
    home();
    const card = await screen.findByTestId('start-preview-defuser');
    expect(card.textContent).toContain('Staging preview · not released');
    expect(card.textContent).toContain('Defuser');
    expect(screen.queryByText('Coming soon')).toBeNull();
  });

  it('the recent-game card names the team for a co-op game', async () => {
    games = [];
    recent = [
      {
        sessionId: 's',
        roomId: 'r',
        gameType: 'defuser',
        outcome: 'coop_win',
        reason: 'defused',
        opponent: null,
        turns: 5,
        teammates: [{ userId: 'u2', displayName: 'Jon', photoUrl: null, role: 'operator' }],
        coop: { role: 'analyst', roleChange: null, panelsSolved: 3, faults: 0, msRemaining: 1 },
        startedAt: '2026-10-07T10:00:00Z',
        endedAt: '2026-10-07T10:05:00Z',
      } as unknown as MatchSummary,
    ];
    home();
    expect(await screen.findByText('with Jon')).toBeTruthy();
    expect(screen.getByText('Defused')).toBeTruthy();
  });
});

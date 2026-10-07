// @vitest-environment jsdom
import type { MatchSummary } from '@rivalrush/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MatchList } from '../src/pages/ProfilePage';

afterEach(cleanup);

const base = {
  roomId: 'room00000001',
  turns: 4,
  startedAt: '2026-10-07T10:00:00Z',
  endedAt: '2026-10-07T10:05:00Z',
};

describe('history rows', () => {
  it('names the opponent for a duel', () => {
    const duel: MatchSummary = {
      ...base,
      sessionId: 'a',
      gameType: 'crack-the-code',
      outcome: 'win',
      reason: 'cracked',
      opponent: { userId: 'u2', displayName: 'Ben', photoUrl: null },
      teammates: [],
      coop: null,
    } as MatchSummary;
    render(<MatchList matches={[duel]} />);
    expect(screen.getByTestId('match-title').textContent).toBe('vs Ben');
  });

  it('names the team for a co-op game, with its outcome', () => {
    const coop = {
      ...base,
      sessionId: 'b',
      gameType: 'defuser',
      outcome: 'coop_win',
      reason: 'defused',
      opponent: null,
      teammates: [
        { userId: 'u1', displayName: 'Ivy', photoUrl: null, role: 'operator' },
        { userId: 'u3', displayName: 'Kai', photoUrl: null, role: 'analyst' },
      ],
      coop: { role: 'analyst', roleChange: null, panelsSolved: 3, faults: 1, msRemaining: 90_000 },
    } as unknown as MatchSummary;
    render(<MatchList matches={[coop]} />);
    expect(screen.getByTestId('match-title').textContent).toBe('with Ivy, Kai');
    expect(screen.getByTestId('match-list').textContent).toContain('Defuser');
    expect(screen.getByTestId('match-list').textContent).toContain('Defused');
  });
});

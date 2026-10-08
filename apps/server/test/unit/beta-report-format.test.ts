import { describe, expect, it } from 'vitest';
import type { BetaReport } from '../../src/analytics/betaReport.js';
import { formatBetaReport, parseDay, parseTesters } from '../../src/analytics/betaReportFormat.js';

describe('parseDay', () => {
  it('reads a day as midnight in the given time zone', () => {
    expect(parseDay('2026-10-12', 'UTC').toISOString()).toBe('2026-10-12T00:00:00.000Z');
    expect(parseDay('2026-10-12', 'Europe/Berlin').toISOString()).toBe('2026-10-11T22:00:00.000Z');
    expect(parseDay('2026-10-12', 'America/New_York').toISOString()).toBe(
      '2026-10-12T04:00:00.000Z',
    );
    expect(parseDay('2026-10-12', 'Asia/Kolkata').toISOString()).toBe('2026-10-11T18:30:00.000Z');
  });

  it('handles the days daylight saving changes', () => {
    // Berlin leaves summer time at 03:00 on 25 Oct: midnight is still UTC+2.
    expect(parseDay('2026-10-25', 'Europe/Berlin').toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(parseDay('2026-10-26', 'Europe/Berlin').toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  it('takes a full ISO timestamp as is and refuses anything else', () => {
    expect(parseDay('2026-10-12T09:30:00Z', 'Europe/Berlin').toISOString()).toBe(
      '2026-10-12T09:30:00.000Z',
    );
    expect(() => parseDay('12.10.2026', 'UTC')).toThrow(/Not a date/);
    expect(() => parseDay('2026-02-30', 'UTC')).toThrow(/Not a date/);
    expect(() => parseDay('2026-10-12T09:30', 'UTC')).toThrow(/Not a date/);
    expect(() => parseDay('2026-10-12', 'Mars/Olympus')).toThrow();
  });
});

describe('parseTesters', () => {
  it('reads ids and usernames, one per line, ignoring comments and case', () => {
    const t = parseTesters('# beta group 1\n123456\n@Ana_B\n\nben  # Ben from work\n-42\n');
    expect([...t.ids]).toEqual([123456, -42]);
    expect([...t.usernames]).toEqual(['ana_b', 'ben']);
  });
});

const base: BetaReport = {
  window: {
    since: '2026-10-12T00:00:00.000Z',
    until: '2026-10-19T00:00:00.000Z',
    timeZone: 'UTC',
  },
  rooms: { created: 10, joined: 7 },
  starts: { started: 20, unfinished: 2, trackedSince: '2026-10-09T10:00:00.000Z' },
  matches: {
    total: 18,
    normal: 15,
    forfeit: 2,
    abandoned: 1,
    rematches: 9,
    byReason: { cracked: 12, out_of_guesses: 3, forfeit: 2, abandoned: 1 },
    byGame: [
      { gameType: 'color-cipher', matches: 6, rematches: 3, abandoned: 0 },
      { gameType: 'crack-the-code', matches: 12, rematches: 6, abandoned: 1 },
    ],
  },
  players: { players: 8, totalGames: 36, threePlusGames: 5, multiDay: 4 },
  daySeven: { eligible: 0, returned: 0 },
  users: { newUsers: 6, viaInvite: 4 },
  outsiders: null,
  daily: [
    {
      day: '2026-10-12',
      rooms: 6,
      joined: 4,
      started: 12,
      matches: 11,
      normal: 9,
      abandoned: 1,
      rematches: 5,
      players: 6,
    },
    {
      day: '2026-10-13',
      rooms: 4,
      joined: 3,
      started: 8,
      matches: 7,
      normal: 6,
      abandoned: 0,
      rematches: 4,
      players: 5,
    },
  ],
};

describe('formatBetaReport', () => {
  const text = formatBetaReport(base, 'rivalrush');

  it('prints every metric against its target', () => {
    expect(text).toContain('database rivalrush');
    expect(text).toMatch(/Invite → join\s+70%\s+7 of 10 rooms reached 2 players\s+≥ 60%/);
    expect(text).toMatch(/Match completion\s+75%\s+15 normal endings \/ 20 started/);
    expect(text).toMatch(/Abandon rate\s+5%\s+1 abandoned \/ 20 started\s+≤ 5%/);
    expect(text).toMatch(/Rematch rate\s+50%\s+9 of 18 matches/);
    expect(text).toMatch(/Games per active user\s+4\.5\s+8 players · 5 played 3\+/);
    expect(text).toMatch(/Multi-day players\s+50%/);
    expect(text).toMatch(/Day-7 return\s+n\/a\s+nobody started 7\+ days before the end/);
    expect(text).toMatch(/Organic invite rate\s+67%\s+4 of 6 new users/);
    expect(text).toMatch(/Outsiders\s+n\/a\s+pass --testers/);
    expect(text).toContain('Games started: 20 · never finished: 2');
    expect(text).toContain('abandoned 1 · cracked 12 · forfeit 2 · out_of_guesses 3');
  });

  it('prints the per-game and per-day tables and a cumulative daily-log row', () => {
    expect(text).toMatch(/color-cipher\s+6\s+3\s+0/);
    expect(text).toMatch(/2026-10-13\s+4\s+3\s+8\s+7\s+6\s+0\s+4\s+5/);
    expect(text).toContain('| 2026-10-13 |  | 10 | 7 | 20 | 18 | 15 | 1 | 9 | 8 | 4 |  |  |');
  });

  it('points at the Render logs when no game start was recorded', () => {
    const none = formatBetaReport(
      { ...base, starts: { started: 0, unfinished: 0, trackedSince: null }, outsiders: 3 },
      'rivalrush',
    );
    expect(none).toMatch(/Match completion\s+n\/a\s+n\/a: count game.started in the Render logs/);
    expect(none).toMatch(/Abandon rate\s+n\/a/);
    expect(none).toContain('no starts recorded yet (deploy this version first)');
    expect(none).toMatch(/Outsiders\s+3\s+players not on the tester list/);
  });
});

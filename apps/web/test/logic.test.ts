import type { RoomEvent, RoomSnapshot } from '@rivalrush/shared';
import { describe, expect, it } from 'vitest';
import { formatSeconds, remainingMs, serverOffset } from '../src/lib/clock';
import { inviteLinkFor } from '../src/lib/invite';
import { acceptSnapshot, describeEvent } from '../src/store/roomLogic';

const snap = (version: number, roomId = 'room00000001'): RoomSnapshot =>
  ({
    roomId,
    version,
    players: [
      { userId: 'me', displayName: 'Me' },
      { userId: 'opp', displayName: 'Ben' },
    ],
  }) as unknown as RoomSnapshot;

describe('acceptSnapshot (snapshots are the source of truth)', () => {
  it('applies newer or equal versions and ignores older ones', () => {
    const v5 = snap(5);
    expect(acceptSnapshot(null, v5, 'room00000001')).toBe(v5);
    expect(acceptSnapshot(v5, snap(4), 'room00000001')).toBe(v5);
    const v6 = snap(6);
    expect(acceptSnapshot(v5, v6, 'room00000001')).toBe(v6);
  });

  it('ignores snapshots for another room', () => {
    const v5 = snap(5);
    expect(acceptSnapshot(v5, snap(9, 'otherroom123'), 'room00000001')).toBe(v5);
  });
});

describe('describeEvent', () => {
  const ev = (
    type: RoomEvent['type'],
    actorId: string | null,
    data?: Record<string, unknown>,
  ): RoomEvent => ({
    type,
    roomId: 'room00000001',
    version: 1,
    at: 0,
    actorId,
    ...(data ? { data } : {}),
  });

  it('announces the opponent joining, not yourself', () => {
    expect(
      describeEvent(ev('player_joined', 'opp', { displayName: 'Ben' }), snap(1), 'me')?.text,
    ).toBe('Ben joined');
    expect(
      describeEvent(ev('player_joined', 'me', { displayName: 'Me' }), snap(1), 'me'),
    ).toBeNull();
  });

  it('explains timeouts and last chance from each side', () => {
    expect(describeEvent(ev('turn_timed_out', 'me'), snap(1), 'me')?.text).toMatch(/turn skipped/);
    expect(describeEvent(ev('turn_timed_out', 'opp'), snap(1), 'me')?.text).toMatch(
      /Ben ran out of time/,
    );
    expect(describeEvent(ev('last_chance', 'me'), snap(1), 'me')?.text).toMatch(/Last chance/);
  });

  it('flags rematch requests and reconnects', () => {
    expect(describeEvent(ev('rematch_requested', 'opp'), snap(1), 'me')?.text).toMatch(/rematch/);
    expect(
      describeEvent(ev('player_online', 'opp', { reconnected: true }), snap(1), 'me')?.text,
    ).toBe('Ben is back');
    expect(
      describeEvent(ev('player_online', 'opp', { reconnected: false }), snap(1), 'me'),
    ).toBeNull();
  });
});

describe('server-time countdowns', () => {
  it('uses the server offset, never the raw device clock', () => {
    const offset = serverOffset(10_000, 9_000); // device is 1s behind
    expect(remainingMs(20_000, offset, 9_000)).toBe(10_000);
    expect(remainingMs(20_000, offset, 30_000)).toBe(0);
    expect(remainingMs(null, offset)).toBeNull();
    expect(formatSeconds(9_100)).toBe('10');
    expect(formatSeconds(75_000)).toBe('1:15');
  });
});

describe('invite links', () => {
  it('uses the Telegram startapp deep link when a bot is configured', () => {
    expect(inviteLinkFor('Ab3dEf7Hj9Kl2Mn4', '@RivalRushBot', 'https://x.app')).toBe(
      'https://t.me/RivalRushBot?startapp=room_Ab3dEf7Hj9Kl2Mn4',
    );
    expect(inviteLinkFor('Ab3dEf7Hj9Kl2Mn4', '', 'http://localhost:5173')).toBe(
      'http://localhost:5173/join/Ab3dEf7Hj9Kl2Mn4',
    );
  });
});

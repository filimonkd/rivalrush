import type { RoomEvent, RoomSnapshot } from '@rivalrush/shared';

/**
 * Snapshots are the source of truth; events are only feedback. A snapshot is applied only
 * if it is for the current room and not older than what we already have.
 */
export function acceptSnapshot(
  current: RoomSnapshot | null,
  incoming: RoomSnapshot,
  roomId: string | null,
): RoomSnapshot | null {
  if (roomId && incoming.roomId !== roomId) return current;
  if (current && current.roomId === incoming.roomId && incoming.version < current.version)
    return current;
  return incoming;
}

const nameOf = (snap: RoomSnapshot | null, userId: string | null) =>
  snap?.players.find((p) => p.userId === userId)?.displayName ?? 'Your opponent';

/** Human feedback for an event, or null if it doesn't deserve a toast. */
export function describeEvent(
  e: RoomEvent,
  snap: RoomSnapshot | null,
  me: string | null,
): {
  text: string;
  kind: 'info' | 'good' | 'bad';
  haptic?: 'success' | 'warning' | 'error' | 'tap';
} | null {
  const mine = e.actorId === me;
  switch (e.type) {
    case 'player_joined':
      return mine
        ? null
        : {
            text: `${String(e.data?.displayName ?? 'Someone')} joined`,
            kind: 'good',
            haptic: 'success',
          };
    case 'player_left':
      if (e.data?.expired) return { text: 'This room expired', kind: 'bad' };
      return mine
        ? null
        : { text: `${nameOf(snap, e.actorId)} left`, kind: 'bad', haptic: 'warning' };
    case 'player_ready':
      return mine || !e.data?.ready
        ? null
        : { text: `${nameOf(snap, e.actorId)} is ready`, kind: 'good', haptic: 'tap' };
    case 'host_changed':
      return e.actorId === me ? { text: "You're the host now", kind: 'info' } : null;
    case 'player_offline':
      return mine ? null : { text: `${nameOf(snap, e.actorId)} lost connection`, kind: 'bad' };
    case 'player_online':
      return mine || !e.data?.reconnected
        ? null
        : { text: `${nameOf(snap, e.actorId)} is back`, kind: 'good' };
    case 'turn_timed_out':
      return {
        text: mine ? "Time's up — turn skipped" : `${nameOf(snap, e.actorId)} ran out of time`,
        kind: mine ? 'bad' : 'info',
        haptic: mine ? 'warning' : undefined,
      };
    case 'last_chance':
      return {
        text:
          e.actorId === me
            ? 'Last chance! Crack it to tie'
            : 'Code cracked! They get one last guess',
        kind: 'info',
        haptic: 'warning',
      };
    case 'rematch_requested':
      return mine
        ? null
        : { text: `${nameOf(snap, e.actorId)} wants a rematch!`, kind: 'good', haptic: 'tap' };
    case 'game_over':
      // Covers a rival who leaves mid-game: their seat is gone, so no result sheet appears.
      if (e.data?.winnerId === me && e.data.reason === 'forfeit')
        return {
          text: `${nameOf(snap, typeof e.data.loserId === 'string' ? e.data.loserId : null)} gave up — you win`,
          kind: 'good',
          haptic: 'success',
        };
      return null;
    case 'secret_locked':
      if (e.data?.auto && mine)
        return { text: 'Time ran out — we picked a code for you', kind: 'info' };
      return mine ? null : { text: `${nameOf(snap, e.actorId)} locked in a code`, kind: 'info' };
    default:
      return null;
  }
}

import {
  PANEL_NAMES,
  SHEETS,
  type PanelId,
  type RoomEvent,
  type RoomSnapshot,
} from '@rivalrush/shared';

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

/**
 * Display names seen in this room's snapshots. A teammate who leaves loses their seat, and a
 * co-op roster carries ids only, so the room store keeps what it has already seen.
 */
export function rememberNames(
  known: Readonly<Record<string, string>>,
  snap: RoomSnapshot,
): Record<string, string> {
  let next: Record<string, string> | null = null;
  for (const p of snap.players) {
    if (known[p.userId] !== p.displayName) (next ??= { ...known })[p.userId] = p.displayName;
  }
  return next ?? (known as Record<string, string>);
}

const nameOf = (snap: RoomSnapshot | null, userId: string | null) =>
  snap?.players.find((p) => p.userId === userId)?.displayName ??
  (snap?.gameType === 'defuser' ? 'A teammate' : 'Your opponent');

const clockText = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The viewer's role in a Defuser game, from the snapshot they already have. */
const defuserRole = (snap: RoomSnapshot | null): 'operator' | 'analyst' =>
  snap?.game?.view.gameId === 'defuser' && snap.game.view.kind === 'operator'
    ? 'operator'
    : 'analyst';

/**
 * Feedback for the five Defuser events (spec 10). Public facts only: a panel name, a count, the
 * input the Operator chose. Never anything about the answer.
 */
function describeDefuserEvent(
  e: RoomEvent,
  snap: RoomSnapshot | null,
  me: string | null,
): ReturnType<typeof describeEvent> {
  const d = e.data ?? {};
  switch (e.type) {
    case 'device_armed': {
      const left = typeof d.deadlineAt === 'number' ? d.deadlineAt - e.at : null;
      return {
        text: left === null ? 'Armed' : `Armed. ${clockText(left)}`,
        kind: 'info',
        haptic: 'tap',
      };
    }
    case 'panel_solved': {
      const panel = PANEL_NAMES[d.panel as PanelId];
      return panel
        ? {
            text: `${panel} solved, ${String(d.solvedCount)} of 3`,
            kind: 'good',
            haptic: 'success',
          }
        : null;
    }
    case 'fault': {
      const panel = d.panel as PanelId;
      const input = d.input as Record<string, unknown> | undefined;
      const what = !input
        ? ''
        : 'line' in input
          ? `line ${String(input.line)}`
          : 'key' in input
            ? `key ${String(input.key)}`
            : `level ${String(input.level)} · ${input.vent === 'vent' ? 'Vent' : 'Seal'}`;
      const count = `Fault ${String(d.faults)} of 3`;
      return {
        text:
          defuserRole(snap) === 'operator'
            ? `${count}${what ? `: that was ${what}` : ''}`
            : `${count} on ${PANEL_NAMES[panel] ?? 'a panel'}${what ? ` (${what})` : ''}`,
        kind: 'bad',
        haptic: 'error',
      };
    }
    case 'sheets_reassigned': {
      const moves = Array.isArray(d.moves)
        ? (d.moves as Array<{ sheet: string; toPlayerId: string }>)
        : [];
      if (d.reason === 'rejoin') {
        return e.actorId === me
          ? null
          : { text: `${nameOf(snap, e.actorId)} rejoined`, kind: 'info', haptic: 'warning' };
      }
      const mine = moves.filter((m) => m.toPlayerId === me);
      if (mine.length === 0) return null;
      const title = SHEETS.find((s) => s.id === mine[0]!.sheet)?.title ?? 'a sheet';
      return {
        text: mine.length > 1 ? `You now hold ${mine.length} more sheets` : `You now hold ${title}`,
        kind: 'info',
        haptic: 'warning',
      };
    }
    case 'game_over':
      // The result sheet shows the end. A team that fell below two players has no sheet.
      return d.reason === 'abandoned' && !snap?.game
        ? { text: 'Game ended: not enough players', kind: 'bad', haptic: 'warning' }
        : null;
    default:
      return null;
  }
}

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
  if (
    snap?.gameType === 'defuser' &&
    ['device_armed', 'panel_solved', 'fault', 'sheets_reassigned', 'game_over'].includes(e.type)
  ) {
    return describeDefuserEvent(e, snap, me);
  }
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
          e.actorId === me ? 'Last chance! Crack it to tie' : 'Cracked! They get one last guess',
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
        return { text: 'Time ran out — we picked one for you', kind: 'info' };
      return mine ? null : { text: `${nameOf(snap, e.actorId)} is locked in`, kind: 'info' };
    default:
      return null;
  }
}

import type { PlayerSeat, RoomSnapshot } from '@rivalrush/shared';
import { formatSeconds, remainingMs, useNow } from '../../lib/clock';
import { confirmDialog } from '../../lib/telegram';
import { useRoom } from '../../store/room';
import { toast } from '../../store/toasts';
import { Avatar } from '../ui';

/** Opponent, presence, game number and "Give up": the same for every game. */
export function TopBar({
  room,
  opponent,
  over,
  detail,
}: {
  room: RoomSnapshot;
  opponent: PlayerSeat | null;
  over: boolean;
  /** Game-specific line, e.g. "4 digits". */
  detail: string;
}) {
  const offset = useRoom((s) => s.offset);
  const now = useNow(500);
  const grace = opponent?.graceDeadlineAt
    ? remainingMs(opponent.graceDeadlineAt, offset, now)
    : null;
  const giveUp = async () => {
    if (!(await confirmDialog('Give up this game? It counts as a loss.'))) return;
    const err = await useRoom.getState().act({ type: 'FORFEIT' });
    if (err) toast(err.message, 'bad');
  };
  return (
    <div className="flex items-center gap-3">
      {opponent && (
        <div className="relative">
          <Avatar name={opponent.displayName} url={opponent.photoUrl} size={40} />
          <span
            className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-bg ${opponent.online ? 'bg-bull' : 'bg-danger'}`}
          />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-black">vs {opponent?.displayName ?? '—'}</p>
        {grace !== null ? (
          <p className="text-xs font-bold text-danger" data-testid="opponent-away">
            Lost connection · {formatSeconds(grace)}s to return
          </p>
        ) : (
          <p className="text-xs text-muted">
            Game {room.gamesPlayed + (over ? 0 : 1)} · {detail}
          </p>
        )}
      </div>
      {!over && (
        <button
          type="button"
          onClick={giveUp}
          className="rounded-xl px-3 py-2 text-sm font-bold text-danger"
          data-testid="give-up"
        >
          Give up
        </button>
      )}
    </div>
  );
}

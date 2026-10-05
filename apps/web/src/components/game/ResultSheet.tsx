import type { GameResult, PlayerSeat, RoomSnapshot } from '@rivalrush/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { reasonLabel } from '../../lib/games';
import { haptic } from '../../lib/telegram';
import { useRoom } from '../../store/room';
import { useSession } from '../../store/session';
import { toast } from '../../store/toasts';
import { Button } from '../ui';

/**
 * Result, both secrets and rematch: the same for every game. Each game renders its own secrets
 * (digits, color tiles) through `mySecret` / `theirSecret`.
 */
export function ResultSheet({
  room,
  result,
  me,
  opponent,
  secretLabel,
  mySecret,
  theirSecret,
}: {
  room: RoomSnapshot;
  result: GameResult;
  me: string;
  opponent: PlayerSeat | null;
  /** "code" or "pattern". */
  secretLabel: string;
  mySecret: ReactNode;
  theirSecret: ReactNode;
}) {
  const navigate = useNavigate();
  const outcome = result.outcome === 'draw' ? 'draw' : result.winnerId === me ? 'win' : 'loss';
  const mySeat = room.players.find((p) => p.userId === me);
  const sessionId = room.game!.sessionId;
  const buzzed = useRef<string | null>(null);
  // One vote in flight at a time: a double tap must not surface a false "not possible".
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    if (buzzed.current === sessionId) return;
    buzzed.current = sessionId;
    if (outcome === 'win') haptic.success();
    else if (outcome === 'loss') haptic.error();
    else haptic.warning();
    void useSession
      .getState()
      .refreshMe()
      .catch(() => undefined);
  }, [sessionId, outcome]);

  const rematch = async () => {
    if (voting) return;
    setVoting(true);
    const err = await useRoom.getState().rematch();
    setVoting(false);
    if (err) toast(err.message, 'bad');
  };

  const leave = async () => {
    await useRoom.getState().leave();
    navigate('/', { replace: true });
  };

  const title =
    outcome === 'win' ? 'You won! 🏆' : outcome === 'loss' ? 'You lost' : "It's a draw 🤝";
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/50 backdrop-blur-sm">
      <div
        className="mx-auto w-full max-w-md animate-rise rounded-t-[2rem] bg-bg p-6"
        style={{ paddingBottom: 'calc(var(--rr-safe-bottom) + 24px)' }}
        data-testid="result-sheet"
      >
        <p
          className={`text-4xl font-black ${outcome === 'win' ? 'text-bull' : outcome === 'loss' ? 'text-danger' : ''}`}
          data-testid="result-title"
        >
          {title}
        </p>
        <p className="mt-1 text-muted" data-testid="result-reason">
          {reasonLabel(result.reason, room.gameType)}
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3 text-center">
          <div className="rounded-2xl bg-surface p-3">
            <p className="text-xs font-bold uppercase text-muted">Your {secretLabel}</p>
            <div className="mt-1 flex justify-center">{mySecret}</div>
          </div>
          <div className="rounded-2xl bg-surface p-3">
            <p className="text-xs font-bold uppercase text-muted">Their {secretLabel}</p>
            <div className="mt-1 flex justify-center" data-testid="opponent-secret">
              {theirSecret}
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-2">
          {opponent ? (
            mySeat?.wantsRematch ? (
              <Button disabled variant="secondary" data-testid="rematch-waiting">
                Waiting for {opponent.displayName}…
              </Button>
            ) : (
              <Button onClick={rematch} disabled={voting} data-testid="rematch">
                {opponent.wantsRematch
                  ? `${opponent.displayName} wants a rematch — Accept`
                  : 'Rematch'}
              </Button>
            )
          ) : (
            <p className="text-center text-muted">Your rival left.</p>
          )}
          {opponent && !opponent.online && (
            <p className="text-center text-sm text-muted" data-testid="rematch-opponent-offline">
              {opponent.displayName} is offline right now.
            </p>
          )}
          <Button variant="secondary" big={false} onClick={leave}>
            Leave
          </Button>
        </div>
      </div>
    </div>
  );
}

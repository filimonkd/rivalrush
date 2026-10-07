import type { DefuserPlayerAction, RoomSnapshot } from '@rivalrush/shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { remainingMs, useNow } from '../../lib/clock';
import { haptic } from '../../lib/telegram';
import { useRoom } from '../../store/room';
import { toast } from '../../store/toasts';
import { Briefing } from './Briefing';
import { InactiveScreen } from './Inactive';
import { confirmLeaveTeam } from './leave';
import { AnalystManual } from './Manual';
import { OperatorConsole, type ActFn } from './OperatorConsole';
import { DebriefScreen, DefuserResult } from './Result';
import { FaultBar, FaultFlash, PromotionOverlay, RoleBand, RosterDrawer, TopStrip } from './Strip';
import {
  becameOperator,
  crossedTick,
  errorText,
  nameFrom,
  rosterNotices,
  type View,
} from './model';

/**
 * Defuser's screen. It renders the role view the server sent for THIS player and nothing else:
 * the Operator's console, the Analyst's manual, the inactive screen or the debrief. It sends
 * intents (`game:action`) and draws the snapshot that comes back; it never decides an outcome.
 */
export function DefuserGame({ room }: { room: RoomSnapshot }) {
  const view = room.game!.view;
  if (view.gameId !== 'defuser') return null;
  return <DefuserRoom room={room} view={view} />;
}

function DefuserRoom({ room, view }: { room: RoomSnapshot; view: View }) {
  const navigate = useNavigate();
  const offset = useRoom((s) => s.offset);
  const remembered = useRoom((s) => s.names);
  const now = useNow(250);
  const nameOf = (id: string) => (id === view.me ? 'You' : nameFrom(id, room.players, remembered));

  const [teamOpen, setTeamOpen] = useState(false);
  const [debriefOpen, setDebriefOpen] = useState(false);
  const [promoted, setPromoted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [voting, setVoting] = useState(false);

  const msLeft =
    view.phase === 'BRIEFING'
      ? remainingMs(view.briefingDeadlineAt, offset, now)
      : view.phase === 'ARMED'
        ? remainingMs(view.deadlineAt, offset, now)
        : null;

  // Role changes and roster notices are read off successive snapshots (an offline player misses
  // events). Adjusting state while rendering is React's pattern for "compare with the last value".
  const [prevView, setPrevView] = useState<View | null>(null);
  const [prevSession, setPrevSession] = useState(room.game!.sessionId);
  if (room.game!.sessionId !== prevSession) {
    // A new game (rematch) starts clean.
    setPrevSession(room.game!.sessionId);
    setPrevView(null);
    setDebriefOpen(false);
    setPromoted(false);
    setNotice(null);
  } else if (view !== prevView) {
    setPrevView(view);
    if (becameOperator(prevView, view)) setPromoted(true);
    const notices = rosterNotices(prevView, view, nameOf);
    if (notices.length > 0) setNotice(notices.join(' · '));
  }
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  // Presentation only: a light tick at 30, 20 and 10 s. The server owns the deadline.
  const lastLeft = useRef<number | null>(null);
  useEffect(() => {
    if (view.phase === 'ARMED' && crossedTick(lastLeft.current, msLeft)) haptic.tap();
    lastLeft.current = msLeft;
  }, [msLeft, view.phase]);

  // The countdown hit zero locally but the server has not said so yet: ask it, never assume.
  const expired = view.phase === 'ARMED' && msLeft === 0;
  useEffect(() => {
    if (!expired) return undefined;
    const t = setTimeout(() => void useRoom.getState().resync(3000), 1200);
    return () => clearTimeout(t);
  }, [expired]);

  const act: ActFn = async (action: DefuserPlayerAction) => {
    const err = await useRoom.getState().act(action);
    if (!err) return true;
    haptic.error();
    toast(errorText(err), 'bad');
    if (err.code === 'GAME_FINISHED') void useRoom.getState().resync(3000);
    return false;
  };

  const leave = async () => {
    if (await confirmLeaveTeam()) navigate('/', { replace: true });
  };
  const ready = async () => {
    setBusy(true);
    await act({ type: 'READY' });
    setBusy(false);
  };
  const rejoin = async () => {
    setBusy(true);
    await act({ type: 'REJOIN' });
    setBusy(false);
  };
  const rematch = async () => {
    if (voting) return;
    setVoting(true);
    const err = await useRoom.getState().rematch();
    setVoting(false);
    if (err) toast(errorText(err), 'bad');
  };
  const leaveAfterGame = async () => {
    await useRoom.getState().leave();
    navigate('/', { replace: true });
  };

  return (
    <div
      className="mx-auto flex h-full w-full max-w-md flex-col gap-1.5 px-3"
      style={{
        paddingTop: 'calc(var(--rr-safe-top) + 8px)',
        paddingBottom: 'calc(var(--rr-safe-bottom) + 12px)',
      }}
      data-testid="defuser-game"
      data-kind={view.kind}
      data-phase={view.phase}
    >
      <FaultFlash faults={view.faults} />
      <TopStrip view={view} msLeft={msLeft} onTeam={() => setTeamOpen(true)} />
      {(view.kind === 'operator' || view.kind === 'analyst') && <RoleBand view={view} />}
      {view.phase === 'ARMED' && <FaultBar faults={view.faults} />}
      {notice && (
        <p
          className="pointer-events-none fixed inset-x-0 z-20 mx-auto w-fit max-w-[90%] animate-rise rounded-full bg-cow px-4 py-1.5 text-center text-sm font-black text-black shadow-lg"
          style={{ top: 'calc(var(--rr-safe-top) + 84px)' }}
          role="status"
          data-testid="notice"
        >
          {notice}
        </p>
      )}

      {view.kind === 'inactive' && (
        <InactiveScreen view={view} nameOf={nameOf} onRejoin={rejoin} onLeave={leave} busy={busy} />
      )}
      {view.kind === 'debrief' && (
        <div
          className="grid flex-1 place-items-center text-center text-muted"
          data-testid="game-over"
        >
          <p className="text-lg font-bold">Game over</p>
        </div>
      )}
      {(view.kind === 'operator' || view.kind === 'analyst') && view.phase === 'BRIEFING' && (
        <Briefing view={view} seats={room.players} nameOf={nameOf} busy={busy} onReady={ready} />
      )}
      {view.kind === 'operator' && view.phase === 'ARMED' && (
        <OperatorConsole view={view} act={act} />
      )}
      {view.kind === 'analyst' && view.phase === 'ARMED' && (
        <AnalystManual view={view} nameOf={nameOf} />
      )}

      {teamOpen && (
        <RosterDrawer
          roster={view.roster}
          seats={room.players}
          nameOf={nameOf}
          me={view.me}
          offset={offset}
          now={now}
          briefing={view.phase === 'BRIEFING'}
          onClose={() => setTeamOpen(false)}
          onLeave={() => {
            setTeamOpen(false);
            void leave();
          }}
        />
      )}
      {promoted && view.kind === 'operator' && (
        <PromotionOverlay onDismiss={() => setPromoted(false)} />
      )}
      {view.kind === 'debrief' && view.result && !debriefOpen && (
        <DefuserResult
          room={room}
          view={view}
          nameOf={nameOf}
          voting={voting}
          onDebrief={() => setDebriefOpen(true)}
          onRematch={rematch}
          onLeave={leaveAfterGame}
        />
      )}
      {view.kind === 'debrief' && debriefOpen && (
        <DebriefScreen view={view} nameOf={nameOf} onClose={() => setDebriefOpen(false)} />
      )}
    </div>
  );
}

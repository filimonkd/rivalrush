import { lazy, Suspense, useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Screen, Spinner } from '../components/ui';
import { ColorCipherGame } from '../features/color-cipher/ColorCipherGame';
import { confirmLeaveTeam } from '../features/defuser/leave';
import { CrackTheCodeGame } from '../features/crack-the-code/CrackTheCodeGame';
import { useBackButton } from '../lib/useBackButton';
import { useRoom } from '../store/room';
import { toast } from '../store/toasts';
import { LobbyView } from './LobbyView';
import { ErrorScreen } from './StatusScreens';

// Defuser is dev/test only for now: its screens load on demand, outside the main bundle.
const DefuserGame = lazy(() =>
  import('../features/defuser/DefuserGame').then((m) => ({ default: m.DefuserGame })),
);

export function RoomPage() {
  const { roomId = '' } = useParams();
  const navigate = useNavigate();
  const snapshot = useRoom((s) => (s.snapshot?.roomId === roomId ? s.snapshot : null));
  // Duels: Back goes Home without leaving, and the room stays resumable from the Home card.
  // A live Defuser game asks "Leave the team?" first (the team depends on you being there).
  const liveDefuser = snapshot?.gameType === 'defuser' && snapshot.status === 'IN_GAME';
  const askLeave = useCallback(() => {
    void confirmLeaveTeam().then((left) => {
      if (left) navigate('/', { replace: true });
    });
  }, [navigate]);
  useBackButton('/', liveDefuser ? askLeave : undefined);
  const closed = useRoom((s) => s.closed);
  const error = useRoom((s) => s.error);

  useEffect(() => {
    void useRoom.getState().enter(roomId);
    return () => useRoom.getState().exit();
  }, [roomId]);

  useEffect(() => {
    if (!closed) return;
    if (closed.reason === 'expired') toast('This room expired', 'bad');
    navigate('/', { replace: true });
  }, [closed, navigate]);

  if (error) {
    const gone =
      error.code === 'ROOM_NOT_FOUND' ||
      error.code === 'ROOM_EXPIRED' ||
      error.code === 'ROOM_CLOSED';
    return (
      <ErrorScreen
        title={gone ? 'This room is gone' : "Can't open this room"}
        message={error.message}
      />
    );
  }
  if (!snapshot) {
    return (
      <Screen className="items-center justify-center">
        <Spinner label="Joining room…" />
      </Screen>
    );
  }
  if (snapshot.status === 'LOBBY' || snapshot.status === 'READY')
    return <LobbyView room={snapshot} />;
  if (snapshot.game) {
    if (snapshot.gameType === 'defuser')
      return (
        <Suspense
          fallback={
            <Screen className="items-center justify-center">
              <Spinner />
            </Screen>
          }
        >
          <DefuserGame room={snapshot} />
        </Suspense>
      );
    return snapshot.gameType === 'color-cipher' ? (
      <ColorCipherGame room={snapshot} />
    ) : (
      <CrackTheCodeGame room={snapshot} />
    );
  }
  return (
    <Screen className="items-center justify-center">
      <Spinner />
    </Screen>
  );
}

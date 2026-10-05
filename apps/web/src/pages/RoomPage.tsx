import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Screen, Spinner } from '../components/ui';
import { CrackTheCodeGame } from '../features/crack-the-code/CrackTheCodeGame';
import { useBackButton } from '../lib/useBackButton';
import { useRoom } from '../store/room';
import { toast } from '../store/toasts';
import { LobbyView } from './LobbyView';
import { ErrorScreen } from './StatusScreens';

export function RoomPage() {
  // Back goes Home without leaving: the room stays resumable from the Home card.
  useBackButton('/');
  const { roomId = '' } = useParams();
  const navigate = useNavigate();
  const snapshot = useRoom((s) => (s.snapshot?.roomId === roomId ? s.snapshot : null));
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
  if (snapshot.game) return <CrackTheCodeGame room={snapshot} />;
  return (
    <Screen className="items-center justify-center">
      <Spinner />
    </Screen>
  );
}

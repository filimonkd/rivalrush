import type { InvitePreview, RoomSnapshot } from '@rivalrush/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Avatar, Button, Card, Screen, Spinner } from '../components/ui';
import type { ApiError } from '../lib/api';
import { api } from '../lib/api';
import { gameInfo } from '../lib/games';
import { joinErrorMessage } from '../lib/labels';
import { haptic } from '../lib/telegram';
import { useBackButton } from '../lib/useBackButton';
import { useRoom } from '../store/room';
import { ErrorScreen } from './StatusScreens';

export function JoinPage() {
  useBackButton('/');
  const { inviteToken = '' } = useParams();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<{ title: string; message: string; roomId?: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<InvitePreview>(`/rooms/invite/${encodeURIComponent(inviteToken)}`)
      .then(setPreview)
      .catch((e: ApiError) =>
        setError({ title: "Can't join this room", message: joinErrorMessage(e.code, e.message) }),
      );
  }, [inviteToken]);

  const join = async () => {
    setBusy(true);
    try {
      const room = await api<RoomSnapshot>('/rooms/join', {
        method: 'POST',
        body: { inviteToken },
      });
      haptic.success();
      await useRoom.getState().enter(room.roomId, room);
      navigate(`/room/${room.roomId}`, { replace: true });
    } catch (e) {
      haptic.error();
      const err = e as ApiError;
      setError({
        title:
          err.code === 'ALREADY_IN_ROOM'
            ? 'Finish your current game first'
            : "Can't join this room",
        message: joinErrorMessage(err.code, err.message),
        roomId: typeof err.details?.roomId === 'string' ? err.details.roomId : undefined,
      });
      setBusy(false);
    }
  };

  if (error) {
    if (error.roomId) {
      return (
        <Screen className="items-center justify-center gap-4 text-center">
          <h1 className="text-2xl font-black">{error.title}</h1>
          <p className="text-muted">{error.message}</p>
          <Button onClick={() => navigate(`/room/${error.roomId}`)}>Back to my game</Button>
        </Screen>
      );
    }
    return <ErrorScreen title={error.title} message={error.message} />;
  }
  if (!preview) {
    return (
      <Screen className="items-center justify-center">
        <Spinner label="Opening invite…" />
      </Screen>
    );
  }
  if (!preview.joinable && !preview.alreadyMember) {
    return (
      <ErrorScreen
        title="Can't join this room"
        message={joinErrorMessage(preview.reason ?? '', 'This room is not open.')}
      />
    );
  }

  const game = gameInfo(preview.gameType);
  return (
    <Screen className="items-center justify-center gap-6 text-center">
      <Avatar name={preview.host.displayName} url={preview.host.photoUrl} size={96} ring />
      <div>
        <h1 className="text-3xl font-black" data-testid="challenge-title">
          {game.coop
            ? `${preview.host.displayName} needs a team to defuse a Charge`
            : `${preview.host.displayName} challenged you to ${game.name}`}
        </h1>
        <p className="mt-1 text-muted">
          {game.coop
            ? `${game.tagline} · Co-op for 2–4 players, best on a voice call`
            : `${game.tagline} · 1 vs 1`}
        </p>
      </div>
      <Card className="grid w-full grid-cols-3 gap-2 text-center">
        {game.summary(preview.settings).map((item) => (
          <div key={item.label}>
            <p className="text-2xl font-black">{item.value}</p>
            <p className="text-xs text-muted">{item.label}</p>
          </div>
        ))}
      </Card>
      {preview.alreadyMember && preview.roomId ? (
        <Button onClick={() => navigate(`/room/${preview.roomId}`, { replace: true })}>
          Open game
        </Button>
      ) : (
        <Button onClick={join} disabled={busy} data-testid="join-game">
          {busy ? 'Joining…' : 'Join game'}
        </Button>
      )}
    </Screen>
  );
}

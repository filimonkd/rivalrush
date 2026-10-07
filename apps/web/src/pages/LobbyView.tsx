import type { RoomSnapshot } from '@rivalrush/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Avatar, Button, Card, Pill, Screen } from '../components/ui';
import { gameInfo } from '../lib/games';
import { inviteLinkFor, inviteText } from '../lib/invite';
import { confirmDialog, haptic, shareToTelegram } from '../lib/telegram';
import { useRoom } from '../store/room';
import { useSession } from '../store/session';
import { toast } from '../store/toasts';

export function LobbyView({ room }: { room: RoomSnapshot }) {
  const me = useSession((s) => s.user!.id);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const isHost = room.hostId === me;
  const mySeat = room.players.find((p) => p.userId === me);
  const host = room.players.find((p) => p.isHost);
  const full = room.players.length >= room.maxPlayers;
  const link = inviteLinkFor(room.inviteToken);
  const game = gameInfo(room.gameType);
  const coop = game.coop === true;

  const run = async (fn: () => Promise<{ message: string } | null>) => {
    setBusy(true);
    const err = await fn();
    if (err) {
      haptic.error();
      toast(err.message, 'bad');
    }
    setBusy(false);
  };

  const share = async () => {
    const text = inviteText(host?.displayName ?? 'A friend', game.name);
    if (shareToTelegram(link, text)) return;
    if (navigator.share) {
      await navigator.share({ text, url: link }).catch(() => undefined);
      return;
    }
    await copy();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      haptic.success();
      toast('Invite link copied', 'good');
    } catch {
      toast('Copy failed — long-press the link to copy', 'bad');
    }
  };

  const leave = async () => {
    if (!(await confirmDialog('Leave this room?'))) return;
    await useRoom.getState().leave();
    navigate('/', { replace: true });
  };

  return (
    <Screen className="gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">{coop ? 'Team lobby' : 'Lobby'}</h1>
          <p className="text-sm font-bold text-muted" data-testid="lobby-game">
            {game.name}
          </p>
        </div>
        <Pill tone="accent">
          {game
            .summary(room.settings)
            .map((s) => `${s.value} ${s.label}`)
            .join(' · ')}
        </Pill>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: room.maxPlayers }, (_, i) => {
          const p = room.players[i];
          if (!p) {
            return (
              <Card
                key={i}
                className="flex flex-col items-center gap-2 border-2 border-dashed border-muted/30 bg-transparent py-6"
              >
                <div className="grid h-16 w-16 animate-pulse place-items-center rounded-full bg-surface text-2xl text-muted">
                  ?
                </div>
                <p className="font-bold text-muted" data-testid="waiting-opponent">
                  {coop ? 'Waiting for a teammate' : 'Waiting for opponent'}
                </p>
              </Card>
            );
          }
          return (
            <Card key={p.userId} className="flex flex-col items-center gap-2 py-6 animate-pop">
              <div className="relative">
                <Avatar name={p.displayName} url={p.photoUrl} size={64} ring={p.userId === me} />
                <span
                  className={`absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-card ${p.online ? 'bg-bull' : 'bg-muted'}`}
                />
              </div>
              <p className="max-w-full truncate font-black">
                {p.userId === me ? 'You' : p.displayName}
              </p>
              {p.isHost ? (
                <Pill tone="accent">Host</Pill>
              ) : p.ready ? (
                <Pill tone="good">Ready</Pill>
              ) : (
                <Pill>Not ready</Pill>
              )}
            </Card>
          );
        })}
      </div>

      {!full && (
        <Card className="flex flex-col gap-3">
          <p className="font-black">Invite a friend</p>
          <p className="text-sm text-muted">
            Send the link to a Telegram chat. It opens straight into this room.
            {coop && ' Best with voice: start a Telegram call.'}
          </p>
          <p
            className="truncate rounded-xl bg-surface px-3 py-2 font-mono text-xs text-muted select-text"
            data-testid="invite-link"
          >
            {link}
          </p>
          <Button onClick={share} data-testid="send-invite">
            Send invite
          </Button>
          <Button variant="secondary" big={false} onClick={copy}>
            Copy link
          </Button>
        </Card>
      )}

      <div className="mt-auto flex flex-col gap-2">
        {isHost ? (
          <Button
            data-testid="start-game"
            disabled={busy || room.status !== 'READY'}
            onClick={() => run(() => useRoom.getState().start())}
          >
            {room.status === 'READY'
              ? 'Start game'
              : full
                ? coop
                  ? 'Waiting for the team to be ready…'
                  : 'Waiting for opponent to be ready…'
                : coop
                  ? 'Waiting for teammates…'
                  : 'Waiting for opponent…'}
          </Button>
        ) : (
          <Button
            data-testid="ready-toggle"
            variant={mySeat?.ready ? 'secondary' : 'primary'}
            disabled={busy}
            onClick={() => run(() => useRoom.getState().setReady(!mySeat?.ready))}
          >
            {mySeat?.ready ? 'Not ready' : "I'm ready"}
          </Button>
        )}
        <Button variant="danger" big={false} onClick={leave}>
          Leave room
        </Button>
      </div>
    </Screen>
  );
}

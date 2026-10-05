import { useRoom } from '../store/room';

/** Shown whenever the realtime link is down while in a room. */
export function ConnectionBanner() {
  const connection = useRoom((s) => s.connection);
  const inRoom = useRoom((s) => s.roomId !== null);
  if (!inRoom || connection === 'online' || connection === 'idle') return null;
  return (
    <div
      data-testid="reconnecting"
      className="fixed inset-x-0 z-40 mx-auto flex max-w-md items-center justify-center gap-2 bg-cow px-4 py-2 text-sm font-bold text-black"
      style={{ top: 'var(--rr-safe-top)' }}
    >
      <span className="h-2 w-2 animate-ping rounded-full bg-black" />
      {connection === 'connecting' ? 'Connecting…' : 'Reconnecting… your game is safe'}
    </div>
  );
}

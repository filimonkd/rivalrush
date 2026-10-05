import type { ActiveRoomResponse, GameCatalogEntry, MatchSummary } from '@rivalrush/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Avatar, Button, Card, Logo, Pill, Screen } from '../components/ui';
import { api } from '../lib/api';
import { gameInfo } from '../lib/games';
import { outcomeLabel, reasonLabel } from '../lib/labels';
import { useSession } from '../store/session';

export function HomePage() {
  const user = useSession((s) => s.user)!;
  const navigate = useNavigate();
  const [active, setActive] = useState<ActiveRoomResponse['room']>(null);
  const [games, setGames] = useState<GameCatalogEntry[]>([]);
  const [recent, setRecent] = useState<MatchSummary | null>(null);

  useEffect(() => {
    void useSession
      .getState()
      .refreshMe()
      .catch(() => undefined);
    api<ActiveRoomResponse>('/me/active-room')
      .then((r) => setActive(r.room))
      .catch(() => undefined);
    api<{ games: GameCatalogEntry[] }>('/games')
      .then((r) => setGames(r.games))
      .catch(() => undefined);
    api<{ matches: MatchSummary[] }>('/me/matches?limit=1')
      .then((r) => setRecent(r.matches[0] ?? null))
      .catch(() => undefined);
  }, []);

  const s = user.stats;
  return (
    <Screen className="gap-5">
      <header className="flex items-center justify-between">
        <Logo small />
        <Link to="/profile" aria-label="Profile" className="flex items-center gap-2">
          <span className="text-sm font-bold text-muted" data-testid="greeting">
            Hey, {user.firstName}
          </span>
          <Avatar name={user.displayName} url={user.photoUrl} size={36} />
        </Link>
      </header>

      <p className="-mt-2 text-sm text-muted">Quick games. Real rivals.</p>

      {active && (
        <Card className="animate-rise border-2 border-accent">
          <p className="text-xs font-bold uppercase tracking-wider text-accent">
            Your game is waiting
          </p>
          <p className="mt-1 text-lg font-black">
            {gameInfo(active.gameType).name} ·{' '}
            {active.status === 'IN_GAME'
              ? 'Match in progress'
              : active.status === 'FINISHED'
                ? 'Game over — rematch?'
                : 'Lobby open'}
          </p>
          <Button className="mt-3" big={false} onClick={() => navigate(`/room/${active.roomId}`)}>
            Back to the game
          </Button>
        </Card>
      )}

      <button
        type="button"
        data-testid="start-duel"
        onClick={() => navigate('/create')}
        className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-accent to-[#b04aff] p-6 text-left text-white shadow-2xl shadow-accent/30 transition active:scale-[0.98]"
      >
        <div className="absolute -right-6 -top-6 text-[7rem] font-black opacity-15 tabular-nums">
          4821
        </div>
        <p className="text-xs font-bold uppercase tracking-widest opacity-80">Live now</p>
        <p className="mt-1 text-3xl font-black">Crack the Code</p>
        <p className="mt-1 opacity-90">Hide a code. Crack theirs first.</p>
        <span className="mt-5 inline-flex h-12 items-center rounded-2xl bg-white px-5 text-lg font-black text-[#3b1fb8]">
          Start a duel ⚔️
        </span>
      </button>

      <button
        type="button"
        data-testid="start-color-cipher"
        onClick={() => navigate('/create/color-cipher')}
        className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#0b7c86] to-[#6b3fd1] p-6 text-left text-white shadow-2xl shadow-[#0b7c86]/30 transition active:scale-[0.98]"
      >
        <div
          className="absolute -bottom-2 -right-2 grid rotate-12 grid-cols-2 gap-1.5 opacity-40"
          aria-hidden
        >
          {['#e5484d', '#ffc53d', '#30a46c', '#0090ff'].map((c) => (
            <span key={c} className="h-10 w-10 rounded-xl" style={{ backgroundColor: c }} />
          ))}
        </div>
        <p className="text-xs font-bold uppercase tracking-widest opacity-80">Live now · New</p>
        <p className="mt-1 text-3xl font-black">Color Cipher</p>
        <p className="mt-1 opacity-90">Hide a color pattern. Crack theirs first.</p>
        <span className="mt-5 inline-flex h-12 items-center rounded-2xl bg-white px-5 text-lg font-black text-[#0b5d66]">
          Start a duel 🎨
        </span>
      </button>

      <Card>
        <div className="flex items-center justify-between">
          <p className="font-black">Your record</p>
          <Link to="/profile" className="text-sm font-bold text-link">
            Profile
          </Link>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          <Stat label="Wins" value={s.wins} />
          <Stat label="Losses" value={s.losses} />
          <Stat label="Draws" value={s.draws} />
          <Stat label="Streak" value={s.currentStreak} />
        </div>
      </Card>

      {recent && (
        <Card>
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Recent game</p>
          <div className="mt-2 flex items-center justify-between">
            <p className="font-bold">vs {recent.opponent?.displayName ?? 'someone'}</p>
            <Pill
              tone={recent.outcome === 'win' ? 'good' : recent.outcome === 'loss' ? 'bad' : 'muted'}
            >
              {outcomeLabel(recent.outcome)}
            </Pill>
          </div>
          <p className="text-sm text-muted">
            {gameInfo(recent.gameType).name} · {reasonLabel(recent.reason, recent.gameType)}
          </p>
        </Card>
      )}

      {games.some((g) => g.status === 'coming_soon') && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Coming soon</p>
          <div className="flex gap-2">
            {games
              .filter((g) => g.status === 'coming_soon')
              .map((g) => (
                <div key={g.id} className="flex-1 rounded-2xl bg-surface p-3 opacity-70">
                  <p className="font-bold">{g.name}</p>
                  <p className="text-xs text-muted">{g.tagline}</p>
                </div>
              ))}
          </div>
        </div>
      )}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-surface py-2">
      <p className="text-2xl font-black tabular-nums">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

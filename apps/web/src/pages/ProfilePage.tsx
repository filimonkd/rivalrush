import type { MatchSummary, ProfileResponse } from '@rivalrush/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Avatar, Card, Pill, Screen, Spinner } from '../components/ui';
import type { ApiError } from '../lib/api';
import { api } from '../lib/api';
import { gameInfo } from '../lib/games';
import { matchTitle, outcomeLabel, reasonLabel } from '../lib/labels';
import { useBackButton } from '../lib/useBackButton';
import { useSession } from '../store/session';
import { ErrorScreen } from './StatusScreens';

export function MatchList({ matches }: { matches: MatchSummary[] }) {
  if (matches.length === 0)
    return <p className="py-6 text-center text-sm text-muted">No games yet. Start a duel!</p>;
  return (
    <ul className="flex flex-col gap-2" data-testid="match-list">
      {matches.map((m) => {
        // Co-op rows name the team; duel rows the opponent.
        const other = m.coop ? m.teammates[0] : m.opponent;
        const title = matchTitle(m);
        const good = m.outcome === 'win' || m.outcome === 'coop_win';
        const bad = m.outcome === 'loss' || m.outcome === 'coop_loss';
        return (
          <li
            key={m.sessionId}
            className="flex items-center gap-3 rounded-2xl bg-surface px-3 py-2"
          >
            <Avatar name={other?.displayName ?? '?'} url={other?.photoUrl ?? null} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold" data-testid="match-title">
                {title}
              </p>
              <p className="text-xs text-muted">
                {gameInfo(m.gameType).name} · {reasonLabel(m.reason, m.gameType)} ·{' '}
                {new Date(m.endedAt).toLocaleDateString()}
              </p>
            </div>
            <Pill tone={good ? 'good' : bad ? 'bad' : 'muted'}>{outcomeLabel(m.outcome)}</Pill>
          </li>
        );
      })}
    </ul>
  );
}

export function ProfilePage() {
  useBackButton('/');
  const params = useParams();
  const myId = useSession((s) => s.user!.id);
  const userId = params.userId ?? myId;
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ProfileResponse>(`/profile/${userId}`)
      .then(setProfile)
      .catch((e: ApiError) => setError(e.message));
  }, [userId]);

  if (error) return <ErrorScreen title="Profile unavailable" message={error} />;
  if (!profile) {
    return (
      <Screen className="items-center justify-center">
        <Spinner />
      </Screen>
    );
  }
  const { user, winRate, recentMatches } = profile;
  const s = user.stats;
  return (
    <Screen className="gap-4">
      <div className="flex flex-col items-center gap-2 pt-4 text-center">
        <Avatar name={user.displayName} url={user.photoUrl} size={88} ring />
        <h1 className="text-2xl font-black" data-testid="profile-name">
          {user.displayName}
        </h1>
        {user.username && <p className="text-sm text-muted">@{user.username}</p>}
      </div>
      <Card className="grid grid-cols-3 gap-3 text-center">
        <Big label="Played" value={s.gamesPlayed} testId="stat-played" />
        <Big label="Win rate" value={`${winRate}%`} />
        <Big label="Best streak" value={s.bestStreak} />
        <Big label="Wins" value={s.wins} testId="stat-wins" />
        <Big label="Losses" value={s.losses} testId="stat-losses" />
        <Big label="Draws" value={s.draws} testId="stat-draws" />
      </Card>
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-black">Recent games</p>
          {userId === myId && (
            <Link to="/history" className="text-sm font-bold text-link">
              All games
            </Link>
          )}
        </div>
        <p className="mb-2 text-xs text-muted">Current streak: {s.currentStreak}</p>
        <MatchList matches={recentMatches} />
      </Card>
    </Screen>
  );
}

function Big({ label, value, testId }: { label: string; value: number | string; testId?: string }) {
  return (
    <div>
      <p className="text-2xl font-black tabular-nums" data-testid={testId}>
        {value}
      </p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

import type { MatchSummary } from '@rivalrush/shared';
import { useEffect, useState } from 'react';
import { Screen, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useBackButton } from '../lib/useBackButton';
import { MatchList } from './ProfilePage';

export function HistoryPage() {
  useBackButton('/profile');
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  useEffect(() => {
    api<{ matches: MatchSummary[] }>('/me/matches?limit=50')
      .then((r) => setMatches(r.matches))
      .catch(() => setMatches([]));
  }, []);
  return (
    <Screen className="gap-4">
      <h1 className="text-3xl font-black">Match history</h1>
      {matches ? <MatchList matches={matches} /> : <Spinner />}
    </Screen>
  );
}

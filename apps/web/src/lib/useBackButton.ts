import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { showBackButton } from './telegram';

/**
 * Telegram BackButton (and nothing visible outside Telegram) for sub-pages. `override` replaces
 * the default "go to `to`" (a live Defuser game asks "Leave the team?" first).
 */
export function useBackButton(to: string = '/', override?: () => void): void {
  const navigate = useNavigate();
  useEffect(() => showBackButton(override ?? (() => navigate(to))), [navigate, to, override]);
}

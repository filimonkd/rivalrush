import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { showBackButton } from './telegram';

/** Telegram BackButton (and nothing visible outside Telegram) for sub-pages. */
export function useBackButton(to: string = '/'): void {
  const navigate = useNavigate();
  useEffect(() => showBackButton(() => navigate(to)), [navigate, to]);
}

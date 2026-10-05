import { useEffect, useState } from 'react';

/**
 * Countdowns are derived from server deadlines (epoch ms) plus the measured offset between
 * the server clock and this device. The client never decides when time is up.
 */
export function serverOffset(serverTime: number, receivedAt: number): number {
  return serverTime - receivedAt;
}

export function remainingMs(
  deadline: number | null,
  offset: number,
  now = Date.now(),
): number | null {
  if (deadline === null) return null;
  return Math.max(0, deadline - (now + offset));
}

export function formatSeconds(ms: number | null): string {
  if (ms === null) return '';
  const s = Math.ceil(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}`;
}

/** Re-renders every `intervalMs` while mounted. */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

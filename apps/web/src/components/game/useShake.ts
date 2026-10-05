import { useState } from 'react';

/** A short shake animation flag for rejected input. */
export function useShake(): [boolean, () => void] {
  const [shake, setShake] = useState(false);
  const trigger = () => {
    setShake(true);
    setTimeout(() => setShake(false), 400);
  };
  return [shake, trigger];
}

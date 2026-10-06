/**
 * Who starts the next game in a room: the player right after this game's starting player, in
 * the game's seat order, skipping anyone no longer seated. With 2 players this is "the other
 * one" (the original swap); with 3–4 it rotates A → B → C (→ D) → A.
 *
 * Returns null when nobody else is still seated; the next start is then random (existing rule).
 */
export function nextStartingPlayer(
  players: readonly string[],
  startingPlayerId: string,
  isSeated: (userId: string) => boolean,
): string | null {
  const start = players.indexOf(startingPlayerId);
  if (start < 0) return null;
  for (let step = 1; step < players.length; step++) {
    const candidate = players[(start + step) % players.length]!;
    if (isSeated(candidate)) return candidate;
  }
  return null;
}

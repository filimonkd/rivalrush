import type { CcPlayerView, CtcPlayerView, GamePlayerView } from '@rivalrush/shared';

export type DuelPlayerView = CtcPlayerView | CcPlayerView;

/** Narrows a snapshot's game view to the duel views (fails the test on a Defuser view). */
export function duelView(view: GamePlayerView | undefined): DuelPlayerView {
  if (!view) throw new Error('no game view');
  if (view.gameId === 'defuser') throw new Error('expected a duel view, got Defuser');
  return view;
}

import { SHEET_IDS, type SheetId } from '@rivalrush/shared';
import type { GameEvent } from '../engine/types.js';
import {
  LETTERS,
  activeAnalysts,
  activePlayers,
  sheetsHeldBy,
  sinceArmed,
  type DefuserPlayer,
  type DefuserState,
} from './state.js';
import { arm, endGame } from './transitions.js';

/**
 * The drop-out procedure (spec section 14), the only place it is defined. Runs inside one
 * accepted $ABANDON (time-out) or $FORFEIT (Leave) of an ACTIVE player, in BRIEFING or ARMED;
 * the caller has already refused an inactive one (step 0). Mutates `s`.
 */
export function dropOut(
  s: DefuserState,
  player: DefuserPlayer,
  status: 'timed_out' | 'left',
  now: number,
  events: GameEvent[],
): void {
  // Step 1: mark inactive.
  player.status = status;
  s.moves.push({
    kind: 'system',
    playerId: player.id,
    event: status,
    at: now,
    atMs: sinceArmed(s, now),
  });

  // Steps 2–3: fewer than 2 active → ABANDONED.
  if (activePlayers(s).length < 2) {
    endGame(s, 'abandoned', now, events);
    return;
  }

  // Step 4: the Operator dropped out → promote the active Analyst with the earliest letter,
  // even if they are disconnected (the plug-in can't see presence).
  let departing: SheetId[];
  if (player.role === 'operator') {
    const promoted = activeAnalysts(s)[0]!;
    departing = sheetsHeldBy(s, promoted.id);
    releaseSheets(s, promoted.id);
    promoted.role = 'operator';
    s.operatorId = promoted.id;
    // A starting Operator who rejoins gets copies of their replacement's initial sheets.
    if (player.startRole === 'operator' && player.rejoinSheets.length === 0) {
      player.rejoinSheets = [...promoted.rejoinSheets];
    }
    s.moves.push({
      kind: 'system',
      playerId: promoted.id,
      event: 'promoted',
      at: now,
      atMs: sinceArmed(s, now),
    });
    events.push({
      type: 'role_changed',
      actorId: promoted.id,
      data: { operatorId: promoted.id, previousOperatorId: player.id },
    });
  } else {
    departing = sheetsHeldBy(s, player.id);
    releaseSheets(s, player.id);
  }

  // Step 5: redistribute.
  const moves = redistribute(s, departing);
  if (moves.length > 0) {
    events.push({ type: 'sheets_reassigned', actorId: null, data: { reason: 'drop_out', moves } });
  }

  // Step 6: a Leave during the briefing can leave everyone remaining ready.
  if (s.phase === 'BRIEFING' && activePlayers(s).every((p) => p.ready)) arm(s, now, events);
}

function releaseSheets(s: DefuserState, playerId: string): void {
  for (const sheet of SHEET_IDS) s.holders[sheet] = s.holders[sheet].filter((h) => h !== playerId);
}

/**
 * Catalogue order. A sheet another active Analyst already holds (a rejoin copy) stays put;
 * otherwise it goes to the active Analyst holding the fewest sheets, ties to the earliest letter.
 */
export function redistribute(
  s: DefuserState,
  departing: readonly SheetId[],
): Array<{ sheet: SheetId; toPlayerId: string }> {
  const moves: Array<{ sheet: SheetId; toPlayerId: string }> = [];
  const analysts = activeAnalysts(s);
  const sorted = SHEET_IDS.filter((id) => departing.includes(id));
  for (const sheet of sorted) {
    if (s.holders[sheet].some((h) => analysts.some((a) => a.id === h))) continue;
    let to = analysts[0]!;
    for (const a of analysts) {
      if (sheetsHeldBy(s, a.id).length < sheetsHeldBy(s, to.id).length) to = a;
    }
    s.holders[sheet] = [...s.holders[sheet], to.id];
    moves.push({ sheet, toPlayerId: to.id });
  }
  return moves;
}

/**
 * The rejoin rule (section 14): a timed-out, still-seated player comes back during ARMED as an
 * Analyst with copies of their rejoin sheets. Never restores the Operator role.
 */
export function rejoin(s: DefuserState, player: DefuserPlayer, now: number, events: GameEvent[]) {
  player.status = 'active';
  player.role = 'analyst';
  player.rejoined = true;
  if (player.letter === null) {
    player.letter = LETTERS.find((l) => !s.players.some((p) => p.letter === l)) ?? null;
  }
  const moves: Array<{ sheet: SheetId; toPlayerId: string }> = [];
  for (const sheet of SHEET_IDS) {
    if (!player.rejoinSheets.includes(sheet) || s.holders[sheet].includes(player.id)) continue;
    s.holders[sheet] = [...s.holders[sheet], player.id];
    moves.push({ sheet, toPlayerId: player.id });
  }
  s.moves.push({
    kind: 'system',
    playerId: player.id,
    event: 'rejoined',
    at: now,
    atMs: sinceArmed(s, now),
  });
  events.push({ type: 'sheets_reassigned', actorId: player.id, data: { reason: 'rejoin', moves } });
}

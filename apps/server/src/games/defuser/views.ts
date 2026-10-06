import {
  DEFUSER_ID,
  SHEET_IDS,
  type DefuserPlayerView,
  type DefuserPublicView,
  type DefuserSharedView,
} from '@rivalrush/shared';
import { sheetData } from './edition.js';
import { isActive, isLive, playerOf, sheetsHeldBy, type DefuserState } from './state.js';

/**
 * Per-recipient views (spec section 18). The ONLY way Defuser state leaves the server: each
 * view is built field by field, so nothing the recipient may not know is ever copied in.
 */

type Shared = Omit<DefuserSharedView, 'me' | 'editionLabel'>;

function shared(s: DefuserState): Shared {
  return {
    gameId: DEFUSER_ID,
    phase: s.phase,
    version: s.version,
    settings: { ...s.settings },
    roster: s.players.map((p) => ({
      userId: p.id,
      role: isActive(p) ? p.role : null,
      letter: p.letter,
      status: p.status,
      ready: p.ready,
    })),
    sheetIndex: SHEET_IDS.map((sheet) => ({ sheet, holders: [...s.holders[sheet]] })),
    faults: s.faults,
    solved: { ...s.solved },
    cutLines: [...s.cutLines],
    tried: {
      fuse: [...s.tried.fuse],
      glyph: s.tried.glyph.map((e) => ({ ...e })),
      valve: s.tried.valve.map((e) => ({ ...e })),
    },
    briefingDeadlineAt: s.briefingDeadlineAt,
    deadlineAt: s.deadlineAt,
    result: s.result ? { ...s.result, individual: { ...s.result.individual } } : null,
  };
}

export function publicView(s: DefuserState): DefuserPublicView {
  return { ...shared(s), kind: 'public' };
}

export function playerView(s: DefuserState, viewerId: string): DefuserPlayerView {
  const base: DefuserSharedView = {
    ...shared(s),
    me: viewerId,
    editionLabel: s.edition.label,
  };

  // After the end, every seated member sees everything (debrief).
  if (!isLive(s)) {
    return {
      ...base,
      kind: 'debrief',
      charge: structuredClone(s.edition.charge),
      sheets: SHEET_IDS.map((id) => structuredClone(sheetData(s.edition, id))),
      solution: structuredClone(s.edition.solution),
      moves: s.moves.map((m) => structuredClone(m)),
    };
  }

  const me = playerOf(s, viewerId);
  if (!me || !isActive(me)) {
    return {
      ...base,
      kind: 'inactive',
      canRejoin: me?.status === 'timed_out' && s.phase === 'ARMED',
      initialSheets: me?.status === 'timed_out' ? [...me.rejoinSheets] : [],
    };
  }

  // During the briefing nobody gets the Charge or sheet contents.
  const armed = s.phase === 'ARMED';
  if (me.role === 'operator') {
    return {
      ...base,
      kind: 'operator',
      charge: armed ? structuredClone(s.edition.charge) : null,
      litKey: s.litKey,
    };
  }
  return {
    ...base,
    kind: 'analyst',
    sheets: armed
      ? sheetsHeldBy(s, me.id).map((id) => structuredClone(sheetData(s.edition, id)))
      : [],
  };
}

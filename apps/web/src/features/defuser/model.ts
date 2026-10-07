import {
  DEFUSER_COLORS,
  PANEL_NAMES,
  SHEETS,
  type AppErrorPayload,
  type ColorId,
  type CoopResult,
  type DefuserInput,
  type DefuserPlayerView,
  type DefuserRosterEntry,
  type PanelId,
  type SheetId,
} from '@rivalrush/shared';

/**
 * Pure helpers for the Defuser screens: wording, clocks, roster and index lookups. Nothing here
 * solves a puzzle or reads hidden data: it only formats what the server's role view contains.
 */

export type View = DefuserPlayerView;
export type OperatorView = Extract<View, { kind: 'operator' }>;
export type AnalystView = Extract<View, { kind: 'analyst' }>;
export type InactiveView = Extract<View, { kind: 'inactive' }>;
export type DebriefView = Extract<View, { kind: 'debrief' }>;

export const MAX_FAULTS = 3;
/** Presentation only: the last 30 s turn red. The server decides when time is up. */
export const URGENT_MS = 30_000;

/** "4:30", "0:07". */
export function clock(ms: number | null): string {
  if (ms === null) return '–:––';
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export type Urgency = 'calm' | 'urgent';
export function urgency(msLeft: number | null): Urgency {
  return msLeft !== null && msLeft <= URGENT_MS ? 'urgent' : 'calm';
}

/** True when the countdown just crossed 30, 20 or 10 s (a light haptic tick, presentation only). */
export function crossedTick(prevMs: number | null, ms: number | null): boolean {
  if (prevMs === null || ms === null) return false;
  const a = Math.ceil(prevMs / 1000);
  const b = Math.ceil(ms / 1000);
  return [30, 20, 10].some((t) => a > t && b <= t);
}

export const panelName = (p: PanelId) => PANEL_NAMES[p];

export function sheetTitle(id: SheetId): string {
  return SHEETS.find((s) => s.id === id)!.title;
}

/** Roster label: "Operator", "Analyst B". */
export function roleLabel(entry: Pick<DefuserRosterEntry, 'role' | 'letter'>): string {
  if (entry.role === 'operator') return 'Operator';
  if (entry.role === 'analyst') return entry.letter ? `Analyst ${entry.letter}` : 'Analyst';
  return 'Out of the game';
}

export function describeInput(input: DefuserInput): string {
  if ('line' in input) return `line ${input.line}`;
  if ('key' in input) return `key ${input.key}`;
  return `level ${input.level} · ${input.vent === 'vent' ? 'Vent' : 'Seal'}`;
}

/** Fault wording: the Operator's names their own input; an Analyst's names the panel too (spec 19). */
export function faultText(
  role: 'operator' | 'analyst',
  data: { panel?: unknown; faults?: unknown; input?: unknown } | undefined,
): string {
  const faults = Number(data?.faults ?? 0);
  const panel = data?.panel as PanelId | undefined;
  const input = data?.input as DefuserInput | undefined;
  const count = `Fault ${faults} of ${MAX_FAULTS}`;
  if (!panel || !input) return count;
  return role === 'operator'
    ? `${count}: that was ${describeInput(input)}`
    : `${count} on ${panelName(panel)} (${describeInput(input)})`;
}

/**
 * Who starts the next game, from what a player can already see: the roster is in seat order,
 * Analyst letters start right after the starting Operator and wrap, so the starting Operator is
 * the seat just before Analyst A. Then the server's rule: the next seat, skipping anyone who is
 * no longer seated. Returns null when it cannot be told.
 */
export function nextOperatorId(
  roster: readonly DefuserRosterEntry[],
  seatedIds: readonly string[],
): string | null {
  const n = roster.length;
  const a = roster.findIndex((r) => r.letter === 'A');
  if (n < 2 || a < 0) return null;
  const start = (a - 1 + n) % n;
  for (let step = 1; step < n; step++) {
    const candidate = roster[(start + step) % n]!;
    if (seatedIds.includes(candidate.userId)) return candidate.userId;
  }
  return null;
}

/** True when the player was the starting Operator but is not the Operator now (replaced). */
export function wasStartingOperator(roster: readonly DefuserRosterEntry[], me: string): boolean {
  const mine = roster.find((r) => r.userId === me);
  return Boolean(mine && mine.letter === null);
}

const LIVE = ['BRIEFING', 'ARMED'];

/**
 * A newly promoted player: an Analyst who is the Operator in the next snapshot of the SAME live
 * game. Seen from successive snapshots, since an offline player misses the role_changed event. A
 * rematch (the previous view was a debrief) is never a promotion.
 */
export function becameOperator(prev: View | null, next: View): boolean {
  return Boolean(
    prev &&
    prev.me === next.me &&
    prev.kind === 'analyst' &&
    next.kind === 'operator' &&
    LIVE.includes(prev.phase) &&
    LIVE.includes(next.phase) &&
    next.version >= prev.version,
  );
}

/**
 * Plain-language notices from what changed in the public roster between two snapshots of the same
 * game: a time-out, a Leave, a rejoin, a new Operator. Authoritative only: nothing is predicted.
 */
export function rosterNotices(
  prev: View | null,
  next: View,
  nameOf: (userId: string) => string,
): string[] {
  if (!prev || prev.me !== next.me || next.version < prev.version) return [];
  if (!LIVE.includes(prev.phase) && prev.phase !== next.phase) return [];
  const notices: string[] = [];
  const prevOp = prev.roster.find((r) => r.role === 'operator');
  const nextOp = next.roster.find((r) => r.role === 'operator');
  for (const now of next.roster) {
    const before = prev.roster.find((r) => r.userId === now.userId);
    if (!before || before.status === now.status) continue;
    const who = now.userId === next.me ? 'You' : nameOf(now.userId);
    if (now.status === 'timed_out') notices.push(`${who} timed out`);
    else if (now.status === 'left') notices.push(`${who} left the team`);
    else if (now.status === 'active' && before.status === 'timed_out')
      notices.push(`${who} rejoined as an Analyst`);
  }
  if (prevOp && nextOp && prevOp.userId !== nextOp.userId) {
    const who = nextOp.userId === next.me ? 'You are' : `${nameOf(nextOp.userId)} is`;
    notices.push(`Operator dropped out. ${who} now the Operator`);
  }
  return notices;
}

export interface IndexRow {
  sheet: SheetId;
  title: string;
  panel: PanelId;
  holders: string[];
  /** Held by the viewer. */
  mine: boolean;
  /** Its panel is solved. */
  solved: boolean;
}

/** The sheet index (metadata only): every sheet, its holders and whether its panel is solved. */
export function indexRows(view: View): IndexRow[] {
  return SHEETS.map((s) => {
    const holders = view.sheetIndex.find((i) => i.sheet === s.id)?.holders ?? [];
    return {
      sheet: s.id,
      title: s.title,
      panel: s.panel,
      holders,
      mine: holders.includes(view.me),
      solved: view.solved[s.panel],
    };
  });
}

/** The server's refusal as a short, friendly line. Never anything about the answer. */
export function errorText(err: AppErrorPayload): string {
  const rule = (err.details as { rule?: string } | undefined)?.rule;
  switch (rule) {
    case 'not_operator':
      return 'Only the Operator can do that.';
    case 'inactive':
      return "You're out of this game for now. Rejoin to help.";
    case 'already_tried':
      return 'Already tried.';
    case 'line_cut':
      return 'That line is already cut.';
    case 'key_lit':
      return 'That key is already lit.';
    case 'panel_solved':
      return 'That panel is already solved.';
    case 'already_ready':
      return "You're already ready.";
  }
  switch (err.code) {
    case 'GAME_FINISHED':
      return 'The game just ended.';
    case 'GAME_NOT_STARTED':
      return 'Wait until the Charge is armed.';
    case 'GAME_ALREADY_STARTED':
      return 'The Charge is already armed.';
    case 'RATE_LIMITED':
      return 'Slow down a little.';
    case 'RECONNECT_REQUIRED':
      return 'Reconnecting… your game is safe.';
    case 'NOT_ROOM_MEMBER':
      return "You're not in this game.";
    default:
      return err.message || 'That did not work. Try again.';
  }
}

/** What the result headline says (spec 19, rows 10–11). */
export function resultHeadline(result: CoopResult): {
  title: string;
  detail: string;
  tone: 'good' | 'bad' | 'muted';
} {
  if (result.outcome === 'defused') {
    return { title: 'DEFUSED', detail: `${clock(result.msRemaining)} left`, tone: 'good' };
  }
  if (result.outcome === 'detonated') {
    return {
      title: 'DETONATION',
      detail: result.reason === 'faults' ? '3 faults' : 'Time ran out',
      tone: 'bad',
    };
  }
  return { title: 'GAME ENDED', detail: 'not enough players', tone: 'muted' };
}

/** What this player's own result means, in words. */
export function individualLine(result: string | undefined): string {
  switch (result) {
    case 'coop_win':
      return 'You helped defuse it.';
    case 'coop_loss':
      return 'The team lost this one.';
    case 'coop_unfinished':
      return 'The game ended before it could finish.';
    case 'coop_dropped':
      return 'You were out of the game at the end.';
    default:
      return '';
  }
}

/** "Ruby ●": a color is always named with its symbol. */
export function colorName(color: ColorId): string {
  const c = DEFUSER_COLORS[color];
  return `${c.name} ${c.symbol}`;
}

/** How long the valve lever must be held (spec 5.3). */
export const HOLD_MS = 600;

/**
 * A teammate's display name: the live seat if they are still seated, else a name this room's
 * snapshots showed earlier (kept by the room store), else a neutral word. A player who left has no
 * seat, and the public roster carries ids only.
 */
export function nameFrom(
  userId: string,
  seats: ReadonlyArray<{ userId: string; displayName: string }>,
  remembered: Readonly<Record<string, string>>,
): string {
  return seats.find((s) => s.userId === userId)?.displayName ?? remembered[userId] ?? 'A teammate';
}

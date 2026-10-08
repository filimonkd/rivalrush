import {
  DEFUSER_ID,
  PANEL_IDS,
  type DefuserMove,
  type PanelId,
  type PlayerSeat,
  type RoomSnapshot,
} from '@rivalrush/shared';
import { useEffect, useRef, useState } from 'react';
import { HowToPlayButton } from '../../components/HowToPlay';
import { Button } from '../../components/ui';
import { haptic } from '../../lib/telegram';
import { useSession } from '../../store/session';
import { FuseBoard, GlyphBoard, ValveBoard } from './boards';
import { SheetView } from './Manual';
import {
  clock,
  describeInput,
  individualLine,
  nextOperatorId,
  panelName,
  resultHeadline,
  roleLabel,
  type DebriefView,
} from './model';

const TONE = { good: 'text-bull', bad: 'text-danger', muted: 'text-muted' } as const;

/**
 * The team result and the rematch vote. The rematch itself is the platform's room vote: this only
 * shows it. The next Operator is read off the roster the same way the server rotates (seat order).
 */
export function DefuserResult({
  room,
  view,
  nameOf,
  voting,
  onDebrief,
  onRematch,
  onLeave,
}: {
  room: RoomSnapshot;
  view: DebriefView;
  nameOf: (userId: string) => string;
  voting: boolean;
  onDebrief: () => void;
  onRematch: () => void;
  onLeave: () => void;
}) {
  const result = view.result!;
  const head = resultHeadline(result);
  const sessionId = room.game!.sessionId;
  const buzzed = useRef<string | null>(null);
  useEffect(() => {
    if (buzzed.current === sessionId) return;
    buzzed.current = sessionId;
    if (result.outcome === 'defused') haptic.success();
    else if (result.outcome === 'detonated') haptic.error();
    else haptic.warning();
    void useSession
      .getState()
      .refreshMe()
      .catch(() => undefined);
  }, [sessionId, result.outcome]);

  const seats = room.players;
  const solved = PANEL_IDS.filter((p) => view.solved[p]).length;
  const mySeat = seats.find((s) => s.userId === view.me);
  const votes = seats.filter((s) => s.wantsRematch).length;
  const canVote = seats.length >= 2;
  const next = nextOperatorId(
    view.roster,
    seats.map((s) => s.userId),
  );
  const pending = seats.filter((s: PlayerSeat) => !s.wantsRematch && s.userId !== view.me);

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/50 backdrop-blur-sm">
      <div
        className="mx-auto max-h-full w-full max-w-md animate-rise overflow-y-auto rounded-t-[2rem] bg-bg p-5"
        style={{ paddingBottom: 'calc(var(--rr-safe-bottom) + 20px)' }}
        data-testid="result-sheet"
        data-outcome={result.outcome}
      >
        <p className={`text-4xl font-black ${TONE[head.tone]}`} data-testid="result-title">
          {head.title}
        </p>
        <p className="text-lg font-bold" data-testid="result-detail">
          {head.title === 'GAME ENDED' ? `Game ended: ${head.detail}` : head.detail}
        </p>
        <p className="mt-1 text-muted" data-testid="result-you">
          {individualLine(result.individual[view.me])}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 text-center">
          <div className="rounded-2xl bg-surface p-3">
            <p className="text-xs font-bold uppercase text-muted">Panels solved</p>
            <p className="text-2xl font-black tabular-nums" data-testid="result-panels">
              {solved} / 3
            </p>
          </div>
          <div className="rounded-2xl bg-surface p-3">
            <p className="text-xs font-bold uppercase text-muted">Faults</p>
            <p className="text-2xl font-black tabular-nums" data-testid="result-faults">
              {result.faults} / 3
            </p>
          </div>
        </div>

        <ul
          className="mt-3 flex flex-col gap-1.5 rounded-2xl bg-card p-3"
          data-testid="result-roster"
        >
          {view.roster.map((r) => (
            <li key={r.userId} className="flex items-center justify-between gap-2 text-[15px]">
              <span className="truncate font-bold">
                {r.userId === view.me ? 'You' : nameOf(r.userId)}
              </span>
              <span className="shrink-0 text-muted">
                {r.status === 'left'
                  ? 'left'
                  : r.status === 'timed_out'
                    ? 'timed out'
                    : roleLabel(r)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-col gap-2">
          <Button variant="secondary" onClick={onDebrief} data-testid="open-debrief">
            Debrief
          </Button>
          <HowToPlayButton gameId={DEFUSER_ID} className="w-full" />
          {canVote ? (
            mySeat?.wantsRematch ? (
              <Button disabled variant="secondary" data-testid="rematch-waiting">
                Waiting for {pending.map((s) => s.displayName).join(', ') || 'the others'} ({votes}/
                {seats.length})
              </Button>
            ) : (
              <Button onClick={onRematch} disabled={voting} data-testid="rematch">
                Again{votes > 0 ? ` (${votes}/${seats.length} want it)` : ''}
              </Button>
            )
          ) : (
            <p className="text-center text-muted">Everyone else left.</p>
          )}
          {canVote && next && (
            <p className="text-center text-sm text-muted" data-testid="next-operator">
              Next Operator: {next === view.me ? 'You' : nameOf(next)}
            </p>
          )}
          <Button variant="danger" big={false} onClick={onLeave}>
            Leave
          </Button>
        </div>
      </div>
    </div>
  );
}

const mark = (ok: boolean) => (ok ? '✓' : '✕');

/** What the team did on a panel, in order, marked right or wrong. Positions and levels only. */
function PanelMoves({
  panel,
  moves,
  nameOf,
}: {
  panel: PanelId;
  moves: readonly DefuserMove[];
  nameOf: (userId: string) => string;
}) {
  const mine = moves.filter(
    (m): m is Extract<DefuserMove, { kind: 'input' }> => m.kind === 'input' && m.panel === panel,
  );
  if (mine.length === 0) return <p className="text-sm text-muted">No inputs on this panel.</p>;
  return (
    <ul className="flex flex-col gap-1" data-testid={`moves-${panel}`}>
      {mine.map((m, i) => (
        <li key={i} className="flex items-center justify-between text-[15px]">
          <span>
            <span className={m.ok ? 'font-black text-bull' : 'font-black text-danger'}>
              {mark(m.ok)}
            </span>{' '}
            {describeInput(m.input)}
          </span>
          <span className="text-muted">
            {nameOf(m.playerId)} · {clock(m.atMs)}
          </span>
        </li>
      ))}
    </ul>
  );
}

const SYSTEM_TEXT: Record<'timed_out' | 'left' | 'promoted' | 'rejoined', string> = {
  timed_out: 'timed out',
  left: 'left the game',
  promoted: 'became Operator',
  rejoined: 'rejoined as an Analyst',
};

/**
 * The debrief (spec 19): one scrollable page per panel with the Charge as it was armed, both
 * sheets, the correct input and the team's inputs. It is built only from the debrief view the
 * server sends after the game has ended.
 */
export function DebriefScreen({
  view,
  nameOf,
  onClose,
}: {
  view: DebriefView;
  nameOf: (userId: string) => string;
  onClose: () => void;
}) {
  const [panel, setPanel] = useState<PanelId>('fuse');
  const sheets = view.sheets.filter((s) => s.id.startsWith(`${panel}.`));
  const systemMoves = view.moves.filter(
    (m): m is Extract<DefuserMove, { kind: 'system' }> => m.kind === 'system',
  );
  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-bg"
      role="dialog"
      aria-label="Debrief"
      data-testid="debrief"
    >
      <div
        className="mx-auto flex w-full max-w-md items-center justify-between px-4"
        style={{ paddingTop: 'calc(var(--rr-safe-top) + 12px)' }}
      >
        <h1 className="text-2xl font-black">Debrief</h1>
        <button
          type="button"
          onClick={onClose}
          className="h-11 px-3 font-bold text-link"
          data-testid="close-debrief"
        >
          Back to result
        </button>
      </div>
      <div className="mx-auto mt-2 grid w-full max-w-md grid-cols-3 gap-2 px-4" role="tablist">
        {PANEL_IDS.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={panel === p}
            data-testid={`debrief-tab-${p}`}
            onClick={() => setPanel(p)}
            className={`h-11 rounded-xl text-sm font-black ${panel === p ? 'bg-[#f5a524] text-[#2a1a00]' : 'bg-card'}`}
          >
            {view.solved[p] ? '✓ ' : ''}
            {panelName(p)}
          </button>
        ))}
      </div>
      <div
        className="mx-auto mt-3 flex w-full max-w-md flex-1 flex-col gap-3 overflow-y-auto px-4"
        style={{ paddingBottom: 'calc(var(--rr-safe-bottom) + 20px)' }}
      >
        <section
          className="rounded-3xl border border-[#2a3158] bg-[#10142a] p-3 text-[#e8ebff]"
          data-testid="debrief-charge"
        >
          <h2 className="mb-2 text-xs font-black tracking-widest text-[#7d86b8]">
            THE CHARGE AS IT WAS ARMED
          </h2>
          {panel === 'fuse' && (
            <FuseBoard
              charge={view.charge.fuse}
              cutLines={[]}
              selected={null}
              solved
              answer={view.solution.fuse.line}
            />
          )}
          {panel === 'glyph' && (
            <GlyphBoard
              charge={view.charge.glyph}
              litKey={null}
              tried={[]}
              solved
              answer={view.solution.glyph}
            />
          )}
          {panel === 'valve' && (
            <ValveBoard
              charge={view.charge.valve}
              level={view.solution.valve.level}
              vent={view.solution.valve.vent}
              tried={[]}
              solved
            />
          )}
        </section>
        <section
          aria-label="Correct input"
          className="rounded-2xl bg-card p-3"
          data-testid="debrief-answer"
        >
          <h2 className="text-xs font-bold uppercase text-muted">Correct input</h2>
          <p className="text-lg font-black">
            {panel === 'fuse' && `Cut line ${view.solution.fuse.line}`}
            {panel === 'glyph' &&
              `Key ${view.solution.glyph.first}, then key ${view.solution.glyph.second}`}
            {panel === 'valve' &&
              `Level ${view.solution.valve.level} · ${view.solution.valve.vent === 'vent' ? 'Vent' : 'Seal'}`}
          </p>
        </section>
        {sheets.map((s) => (
          <SheetView key={s.id} sheet={s} />
        ))}
        <section className="rounded-2xl bg-card p-3">
          <h2 className="mb-1 text-xs font-bold uppercase text-muted">Your team&apos;s inputs</h2>
          <PanelMoves panel={panel} moves={view.moves} nameOf={nameOf} />
        </section>
        {systemMoves.length > 0 && (
          <section className="rounded-2xl bg-card p-3" data-testid="debrief-timeline">
            <h2 className="mb-1 text-xs font-bold uppercase text-muted">
              Who dropped, who took over
            </h2>
            <ul className="flex flex-col gap-1 text-[15px]">
              {systemMoves.map((m, i) => (
                <li key={i}>
                  <span className="text-muted">{clock(m.atMs)}</span> {nameOf(m.playerId)}{' '}
                  {SYSTEM_TEXT[m.event]}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

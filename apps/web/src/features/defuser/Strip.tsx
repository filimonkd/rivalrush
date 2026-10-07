import {
  PANEL_IDS,
  type DefuserRosterEntry,
  type PanelId,
  type PlayerSeat,
} from '@rivalrush/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Avatar, Button } from '../../components/ui';
import { formatSeconds, remainingMs } from '../../lib/clock';
import { FaultPips } from './art';
import { MAX_FAULTS, clock, panelName, roleLabel, urgency, type View } from './model';

/**
 * The parts every Defuser screen shares, whatever the role: the top strip (countdown, fault pips,
 * panel dots), the role band, the roster drawer and the fault feedback. One game, two perspectives.
 */

const PANEL_SHORT: Record<PanelId, string> = { fuse: 'Fuse', glyph: 'Glyph', valve: 'Valve' };

export function PanelDots({ solved }: { solved: Record<PanelId, boolean> }) {
  return (
    <ul className="flex gap-1.5" aria-label="Panels" data-testid="panel-dots">
      {PANEL_IDS.map((p) => (
        <li
          key={p}
          data-panel={p}
          data-solved={solved[p]}
          className={`flex h-7 min-w-9 items-center justify-center rounded-lg px-1.5 text-xs font-black ${
            solved[p] ? 'bg-bull text-white' : 'border border-muted/40 text-muted'
          }`}
          aria-label={`${panelName(p)} ${solved[p] ? 'solved' : 'not solved'}`}
        >
          {solved[p] ? '✓' : PANEL_SHORT[p][0]}
        </li>
      ))}
    </ul>
  );
}

export function TopStrip({
  view,
  msLeft,
  onTeam,
}: {
  view: View;
  /** Time left to the briefing deadline (BRIEFING) or the detonation deadline (ARMED), or null. */
  msLeft: number | null;
  onTeam: () => void;
}) {
  const urgent = view.phase === 'ARMED' && urgency(msLeft) === 'urgent';
  const live = view.phase === 'BRIEFING' || view.phase === 'ARMED';
  return (
    <header
      className="flex items-center gap-3 rounded-2xl bg-card px-3 py-1.5"
      data-testid="top-strip"
      data-urgent={urgent}
    >
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase leading-none tracking-widest text-muted">
          {view.phase === 'BRIEFING'
            ? 'Briefing'
            : view.phase === 'ARMED'
              ? 'Detonation in'
              : 'Ended'}
        </p>
        <p
          className={`font-mono text-3xl font-black leading-tight tabular-nums ${urgent ? 'text-danger' : ''}`}
          data-testid="countdown"
        >
          {live ? clock(msLeft) : '0:00'}
        </p>
      </div>
      <div className="ml-auto flex flex-col items-end gap-1.5">
        <FaultPips faults={view.faults} />
        <PanelDots solved={view.solved} />
      </div>
      <button
        type="button"
        onClick={onTeam}
        data-testid="open-team"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-muted/40 text-lg"
        aria-label="Team"
      >
        👥
      </button>
    </header>
  );
}

/** The role band: the one thing that tells the two perspectives apart at a glance. */
export function RoleBand({ view, right }: { view: View; right?: ReactNode }) {
  const operator = view.kind === 'operator';
  const mine = view.roster.find((r) => r.userId === view.me);
  const label = operator ? 'OPERATOR' : mine ? roleLabel(mine).toUpperCase() : 'ANALYST';
  return (
    <div
      className={`flex items-center justify-between rounded-xl px-3 py-1.5 text-sm font-black tracking-wide ${
        operator ? 'bg-[#f5a524] text-[#2a1a00]' : 'bg-[#0b7c86] text-white'
      }`}
      data-testid="role-band"
      data-role={view.kind}
    >
      <span>{label}</span>
      <span className="text-xs font-bold opacity-80">
        {right ?? `Edition ${view.editionLabel}`}
      </span>
    </div>
  );
}

/** Two faults: the persistent danger bar (spec 12). */
export function FaultBar({ faults }: { faults: number }) {
  if (faults < MAX_FAULTS - 1 || faults >= MAX_FAULTS) return null;
  return (
    <div
      className="rounded-xl bg-danger px-3 py-1 text-center text-xs font-black tracking-wide text-white"
      role="alert"
      data-testid="fault-bar"
    >
      One more fault detonates the Charge
    </div>
  );
}

/** A single short red flash when a fault lands (≤ 300 ms, never strobing). */
export function FaultFlash({ faults }: { faults: number }) {
  const prev = useRef(faults);
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    if (faults > prev.current) {
      setFlash((n) => n + 1);
      const t = setTimeout(() => setFlash(0), 300);
      prev.current = faults;
      return () => clearTimeout(t);
    }
    prev.current = faults;
    return undefined;
  }, [faults]);
  if (!flash) return null;
  return (
    <div
      key={flash}
      className="pointer-events-none fixed inset-0 z-40 animate-pop bg-danger/35"
      data-testid="fault-flash"
      aria-hidden
    />
  );
}

/** "You are now the Operator": shown from a snapshot change, since an offline player misses the event. */
export function PromotionOverlay({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-6 backdrop-blur-sm"
      role="dialog"
      aria-label="You are now the Operator"
      data-testid="promotion"
    >
      <div className="w-full max-w-sm animate-rise rounded-3xl bg-[#10142a] p-6 text-center text-[#f3f4ff]">
        <p className="text-sm font-black tracking-widest text-[#f5a524]">NEW ROLE</p>
        <p className="mt-1 text-3xl font-black">You are now the Operator</p>
        <p className="mt-3 text-[#b6bce0]">
          The Operator dropped out. You see the Charge now. Describe it; your team tells you what to
          do.
        </p>
        <Button className="mt-5" onClick={onDismiss} data-testid="promotion-ok">
          Got it
        </Button>
      </div>
    </div>
  );
}

/** The team: names, roles, letters, online dots, timed-out and left markers (spec 19, row 5). */
export function RosterDrawer({
  roster,
  seats,
  nameOf,
  me,
  offset,
  now,
  briefing,
  onClose,
  onLeave,
}: {
  roster: readonly DefuserRosterEntry[];
  seats: readonly PlayerSeat[];
  nameOf: (userId: string) => string;
  me: string;
  offset: number;
  now: number;
  briefing: boolean;
  onClose: () => void;
  onLeave: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-30 flex items-end bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-label="Team"
      data-testid="roster-drawer"
      onClick={onClose}
    >
      <div
        className="mx-auto w-full max-w-md animate-rise rounded-t-[2rem] bg-bg p-5"
        style={{ paddingBottom: 'calc(var(--rr-safe-bottom) + 20px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-black">Your team</h2>
          <button type="button" onClick={onClose} className="h-11 px-3 font-bold text-link">
            Close
          </button>
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {roster.map((r) => {
            const seat = seats.find((s) => s.userId === r.userId);
            const away = seat?.graceDeadlineAt
              ? remainingMs(seat.graceDeadlineAt, offset, now)
              : null;
            const name = r.userId === me ? 'You' : nameOf(r.userId);
            const status =
              r.status === 'left'
                ? 'Left the game'
                : r.status === 'timed_out'
                  ? 'Timed out'
                  : away !== null
                    ? `Lost connection · ${formatSeconds(away)}s to return`
                    : null;
            return (
              <li
                key={r.userId}
                className="flex items-center gap-3 rounded-2xl bg-card p-3"
                data-testid="roster-row"
                data-status={r.status}
              >
                <div className="relative">
                  <Avatar name={name} url={seat?.photoUrl ?? null} size={40} />
                  <span
                    className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-card ${
                      r.status !== 'active' ? 'bg-muted' : seat?.online ? 'bg-bull' : 'bg-danger'
                    }`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-black">{name}</p>
                  <p className="text-sm text-muted">{roleLabel(r)}</p>
                  {status && <p className="text-xs font-bold text-danger">{status}</p>}
                </div>
                {briefing && r.status === 'active' && (
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${r.ready ? 'bg-bull/15 text-bull' : 'bg-surface text-muted'}`}
                  >
                    {r.ready ? 'Ready' : 'Not ready'}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <Button
          variant="danger"
          big={false}
          className="mt-3"
          onClick={onLeave}
          data-testid="leave-team"
        >
          Leave the team
        </Button>
      </div>
    </div>
  );
}

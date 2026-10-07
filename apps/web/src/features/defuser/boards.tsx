import {
  FUSE_LINE_COUNT,
  GLYPH_FRAMES,
  GLYPH_KEY_COUNT,
  GLYPH_MARKS,
  VALVE_LEVEL,
  VALVE_PLATE_COLORS,
  type DefuserCharge,
  type DefuserTriedEntries,
  type Vent,
} from '@rivalrush/shared';
import { useEffect, useEffectEvent, useState } from 'react';
import { haptic } from '../../lib/telegram';
import { Bead, Gauge, GlyphArt, Lamp } from './art';
import { HOLD_MS, colorName } from './model';

/**
 * The Operator's device, drawn from the Charge in the role view. Interaction is intent only: a
 * board reports what was tapped; the server decides whether it was right. The same boards render
 * read-only in the debrief.
 */

const INK = '#e8ebff';

// ---------------------------------------------------------------- Fuse Lines

export function FuseBoard({
  charge,
  cutLines,
  selected,
  solved,
  onSelect,
  answer,
}: {
  charge: DefuserCharge['fuse'];
  cutLines: readonly number[];
  selected: number | null;
  solved: boolean;
  /** Omitted when the board is read-only (debrief). */
  onSelect?: (line: number) => void;
  /** Debrief only: the correct line, marked on the board. */
  answer?: number;
}) {
  return (
    <ol
      className="flex flex-col gap-1.5"
      data-testid="fuse-board"
      aria-label="Fuse lines, top to bottom"
    >
      {charge.lines.slice(0, FUSE_LINE_COUNT).map((line, i) => {
        const n = i + 1;
        const cut = cutLines.includes(n);
        const isSel = selected === n;
        const dashed = line.style === 'dashed';
        const stroke = dashed ? 'border-dashed' : 'border-solid';
        const canTap = !!onSelect && !cut && !solved;
        return (
          <li key={n}>
            <button
              type="button"
              disabled={!canTap}
              onClick={() => onSelect?.(n)}
              data-testid={`fuse-line-${n}`}
              data-cut={cut}
              data-selected={isSel}
              data-style={line.style}
              aria-pressed={isSel}
              aria-label={`Line ${n}: ${colorName(line.color)} bead, ${dashed ? 'dashed' : 'solid'} line${cut ? ', cut' : ''}`}
              className={`flex h-12 w-full items-center gap-2 rounded-xl border-2 px-2 text-left transition ${
                isSel ? 'border-[#f5a524] bg-[#f5a524]/10' : 'border-transparent bg-[#171c3a]'
              } ${canTap ? 'active:scale-[0.98]' : ''}`}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#232a52] font-mono text-lg font-black">
                {n}
              </span>
              <span className="flex min-w-0 flex-1 items-center">
                <span
                  className={`h-0 flex-1 border-t-[5px] ${stroke} ${cut ? 'border-[#4b5385]' : 'border-[#9aa3d6]'}`}
                />
                <span className={cut ? 'mx-1 opacity-40 grayscale' : 'mx-1'}>
                  <Bead color={line.color} size={34} />
                </span>
                <span
                  className={`h-0 flex-1 border-t-[5px] ${stroke} ${cut ? 'border-[#4b5385]' : 'border-[#9aa3d6]'} ${cut ? 'ml-3' : ''}`}
                />
              </span>
              <span
                className={`w-12 shrink-0 text-right text-xs font-black ${answer === n ? 'text-[#7dffb2]' : 'text-[#7d86b8]'}`}
              >
                {answer === n ? '✓ CUT' : cut ? '✂ CUT' : dashed ? 'dashed' : 'solid'}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- Glyph Ledger

export function GlyphBoard({
  charge,
  litKey,
  tried,
  solved,
  onPress,
  answer,
}: {
  charge: DefuserCharge['glyph'];
  litKey: number | null;
  tried: DefuserTriedEntries['glyph'];
  solved: boolean;
  onPress?: (key: number) => void;
  /** Debrief only: the correct pair, marked on the keys. */
  answer?: { first: number; second: number };
}) {
  const wrongFirst = tried.filter((e) => e.second === null).map((e) => e.first);
  const wrongSecond =
    litKey === null ? [] : tried.filter((e) => e.first === litKey).map((e) => e.second);
  return (
    <div className="flex flex-col gap-3" data-testid="glyph-board">
      <div className="flex items-center justify-between rounded-xl bg-[#0a0d1f] px-3 py-2">
        <span className="text-xs font-black tracking-widest text-[#7d86b8]">BALANCE</span>
        <span
          className="font-mono text-4xl font-black tabular-nums text-[#7dffb2]"
          data-testid="balance"
        >
          {String(charge.balance).padStart(2, '0')}
        </span>
      </div>
      <ul className="grid grid-cols-4 gap-2" aria-label="Keys, left to right">
        {charge.keys.slice(0, GLYPH_KEY_COUNT).map((glyph, i) => {
          const n = i + 1;
          const lit = litKey === n;
          const known = litKey === null ? wrongFirst.includes(n) : wrongSecond.includes(n);
          const canTap = !!onPress && !solved && !lit && !known;
          return (
            <li key={n}>
              <button
                type="button"
                disabled={!canTap}
                onClick={() => onPress?.(n)}
                data-testid={`glyph-key-${n}`}
                data-lit={lit}
                data-tried={known}
                aria-pressed={lit}
                aria-label={`Key ${n}: ${GLYPH_FRAMES[glyph.frame]} with a ${GLYPH_MARKS[glyph.mark]}${lit ? ', first key, lit' : ''}${known ? ', already tried' : ''}`}
                className={`relative flex h-[104px] w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 transition ${
                  lit
                    ? 'border-[#f5a524] bg-[#f5a524]/15 shadow-[0_0_14px_#f5a52466]'
                    : 'border-transparent bg-[#171c3a]'
                } ${known ? 'opacity-40' : ''} ${canTap ? 'active:scale-95' : ''}`}
                style={{ color: INK }}
              >
                <GlyphArt frame={glyph.frame} mark={glyph.mark} size={54} />
                <span className="font-mono text-sm font-black text-[#7d86b8]">{n}</span>
                {(lit || answer?.first === n || answer?.second === n) && (
                  <span className="absolute -right-1 -top-1 grid h-6 min-w-6 place-items-center rounded-full bg-[#f5a524] px-1 text-xs font-black text-[#2a1a00]">
                    {answer ? (answer.first === n ? '1st' : '2nd') : '1st'}
                  </span>
                )}
                {known && (
                  <span className="absolute right-1 top-1 text-sm font-black text-danger">✕</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-center text-sm font-bold text-[#b6bce0]" data-testid="glyph-hint">
        {answer
          ? `Correct entry: key ${answer.first}, then key ${answer.second}`
          : solved
            ? 'Ledger entered'
            : litKey === null
              ? 'Press two keys, in order. Order matters: first key now.'
              : `Key ${litKey} is lit. Now press the second key.`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- Coolant Valve

const VENT_LABEL: Record<Vent, string> = { seal: 'SEAL', vent: 'VENT' };

/** A control that only fires after being held (spec: 0.6 s for the valve commit). */
export function HoldButton({
  label,
  holdingLabel,
  disabled,
  onComplete,
  testId,
  ms = HOLD_MS,
}: {
  label: string;
  holdingLabel: string;
  disabled?: boolean;
  onComplete: () => void;
  testId: string;
  ms?: number;
}) {
  const [holding, setHolding] = useState(false);
  // A control that becomes disabled mid-hold is released, not paused (adjusting state in render).
  if (disabled && holding) setHolding(false);
  const complete = useEffectEvent(onComplete);

  // The hold is a timer owned by this effect: releasing, leaving or unmounting clears it, so a
  // commit can only fire after an uninterrupted hold of `ms`.
  useEffect(() => {
    if (!holding) return undefined;
    const t = setTimeout(() => {
      setHolding(false);
      complete();
    }, ms);
    return () => clearTimeout(t);
  }, [holding, ms]);

  const start = () => {
    if (disabled || holding) return;
    haptic.press();
    setHolding(true);
  };
  const stop = () => setHolding(false);

  return (
    <button
      type="button"
      disabled={disabled}
      data-testid={testId}
      data-holding={holding}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') stop();
      }}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'none' }}
      className="relative h-14 w-full select-none overflow-hidden rounded-2xl bg-[#ff5470] text-lg font-black text-white disabled:opacity-40"
    >
      <span
        className="absolute inset-y-0 left-0 bg-black/30"
        style={{
          width: holding ? '100%' : '0%',
          transition: holding ? `width ${ms}ms linear` : 'none',
        }}
        aria-hidden
      />
      <span className="relative">{holding ? holdingLabel : label}</span>
    </button>
  );
}

export function ValveBoard({
  charge,
  level,
  vent,
  tried,
  solved,
  onLevel,
  onVent,
  onCommit,
}: {
  charge: DefuserCharge['valve'];
  level: number;
  vent: Vent;
  tried: DefuserTriedEntries['valve'];
  solved: boolean;
  onLevel?: (level: number) => void;
  onVent?: (vent: Vent) => void;
  /** Called once the commit lever has been held long enough. */
  onCommit?: () => void;
}) {
  const interactive = !!onCommit && !solved;
  const plate = VALVE_PLATE_COLORS[charge.plate] ?? VALVE_PLATE_COLORS[0]!;
  const known = tried.some((e) => e.level === level && e.vent === vent);
  const levels = Array.from(
    { length: VALVE_LEVEL.max - VALVE_LEVEL.min + 1 },
    (_, i) => VALVE_LEVEL.min + i,
  );
  return (
    <div className="flex flex-col gap-2" data-testid="valve-board">
      <div className="flex items-center gap-3">
        <Gauge value={charge.gauge} size={106} />
        <div className="flex min-w-0 flex-1 flex-col gap-2 text-[#e8ebff]">
          <div className="rounded-xl bg-[#171c3a] px-3 py-1.5" data-testid="valve-plate">
            <p className="text-[10px] font-black tracking-widest text-[#7d86b8]">PLATE</p>
            <p className="flex items-center gap-2 font-black">
              <Bead color={plate} size={26} />
              {colorName(plate)}
            </p>
          </div>
          <div className="rounded-xl bg-[#171c3a] px-3 py-1.5" data-testid="valve-lamp">
            <p className="text-[10px] font-black tracking-widest text-[#7d86b8]">LAMP</p>
            <Lamp lamp={charge.lamp} />
          </div>
        </div>
      </div>

      <div className="text-[#e8ebff]">
        <p className="mb-1 text-[10px] font-black tracking-widest text-[#7d86b8]">LEVEL</p>
        <div className="grid grid-cols-5 gap-2" role="group" aria-label="Level">
          {levels.map((l) => (
            <button
              key={l}
              type="button"
              disabled={!interactive}
              onClick={() => onLevel?.(l)}
              data-testid={`valve-level-${l}`}
              aria-pressed={level === l}
              className={`h-12 rounded-xl font-mono text-xl font-black transition ${
                level === l ? 'bg-[#f5a524] text-[#2a1a00]' : 'bg-[#171c3a]'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="text-[#e8ebff]">
        <p className="mb-1 text-[10px] font-black tracking-widest text-[#7d86b8]">SWITCH</p>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Seal or Vent">
          {(['seal', 'vent'] as const).map((v) => (
            <button
              key={v}
              type="button"
              disabled={!interactive}
              onClick={() => onVent?.(v)}
              data-testid={`valve-${v}`}
              aria-pressed={vent === v}
              className={`h-12 rounded-xl text-lg font-black tracking-wide transition ${
                vent === v ? 'bg-[#f5a524] text-[#2a1a00]' : 'bg-[#171c3a]'
              }`}
            >
              {VENT_LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      {onCommit && (
        <div>
          <HoldButton
            testId="valve-commit"
            label={solved ? 'COMMITTED' : known ? 'ALREADY TRIED' : 'HOLD TO COMMIT'}
            holdingLabel="KEEP HOLDING…"
            disabled={!interactive || known}
            onComplete={onCommit}
          />
        </div>
      )}
    </div>
  );
}

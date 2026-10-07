import {
  DEFUSER_COLORS,
  GLYPH_FRAMES,
  GLYPH_MARKS,
  type ColorId,
  type ValveLamp,
} from '@rivalrush/shared';
import { FILL, INK } from '../color-cipher/palette';
import { colorName } from './model';
import { MAX_FAULTS } from './model';

/**
 * Defuser's drawn parts: beads, glyphs, the gauge, the lamp and the fault pips. Original line art
 * built from simple shapes; every color also carries its symbol so hue is never the only cue.
 */

/** A round bead: the color and its symbol. */
export function Bead({ color, size = 36 }: { color: ColorId; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-black shadow-[inset_0_-3px_0_rgba(0,0,0,0.22)]"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        backgroundColor: FILL[color],
        color: INK[color],
      }}
      role="img"
      aria-label={colorName(color)}
      data-color={color}
    >
      {DEFUSER_COLORS[color].symbol}
    </span>
  );
}

const STROKE = 'currentColor';

/** A glyph: a frame (Circle, Triangle, Square, Hexagon) around an inner mark (Dot, Bar, Cross, Ring). */
export function GlyphArt({
  frame,
  mark,
  size = 56,
}: {
  frame: number;
  mark: number;
  size?: number;
}) {
  const label = `${GLYPH_FRAMES[frame]} with a ${GLYPH_MARKS[mark]}`;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      data-frame={frame}
      data-mark={mark}
      className="shrink-0"
    >
      {frame === 0 && <circle cx="32" cy="32" r="27" fill="none" stroke={STROKE} strokeWidth="4" />}
      {frame === 1 && (
        <polygon
          points="32,6 59,55 5,55"
          fill="none"
          stroke={STROKE}
          strokeWidth="4"
          strokeLinejoin="round"
        />
      )}
      {frame === 2 && (
        <rect
          x="6"
          y="6"
          width="52"
          height="52"
          rx="6"
          fill="none"
          stroke={STROKE}
          strokeWidth="4"
        />
      )}
      {frame === 3 && (
        <polygon
          points="32,4 56,18 56,46 32,60 8,46 8,18"
          fill="none"
          stroke={STROKE}
          strokeWidth="4"
          strokeLinejoin="round"
        />
      )}
      <g transform={frame === 1 ? 'translate(0 6)' : undefined}>
        {mark === 0 && <circle cx="32" cy="32" r="6" fill={STROKE} />}
        {mark === 1 && <rect x="19" y="28" width="26" height="8" rx="3" fill={STROKE} />}
        {mark === 2 && (
          <path
            d="M22 22 L42 42 M42 22 L22 42"
            stroke={STROKE}
            strokeWidth="6"
            strokeLinecap="round"
          />
        )}
        {mark === 3 && <circle cx="32" cy="32" r="9" fill="none" stroke={STROKE} strokeWidth="5" />}
      </g>
    </svg>
  );
}

/** The valve gauge: a needle on a 240° arc and a two-digit readout (00–99). */
export function Gauge({ value, size = 150 }: { value: number; size?: number }) {
  const angle = -120 + (Math.max(0, Math.min(99, value)) / 99) * 240;
  const tick = (i: number) => {
    const a = ((-120 + (i / 10) * 240 - 90) * Math.PI) / 180;
    return {
      x1: 60 + 44 * Math.cos(a),
      y1: 60 + 44 * Math.sin(a),
      x2: 60 + 52 * Math.cos(a),
      y2: 60 + 52 * Math.sin(a),
    };
  };
  return (
    <div className="relative" style={{ width: size, height: size }} data-testid="gauge">
      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size}
        role="img"
        aria-label={`Gauge reads ${String(value).padStart(2, '0')}`}
      >
        <circle cx="60" cy="60" r="56" fill="#0a0d1f" stroke="#2f3763" strokeWidth="3" />
        {Array.from({ length: 11 }, (_, i) => (
          <line key={i} {...tick(i)} stroke="#6f79ad" strokeWidth="2" strokeLinecap="round" />
        ))}
        <g transform={`rotate(${angle} 60 60)`} className="transition-transform duration-500">
          <line
            x1="60"
            y1="64"
            x2="60"
            y2="18"
            stroke="#ff5470"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
        <circle cx="60" cy="60" r="6" fill="#ff5470" />
      </svg>
      <span className="absolute inset-x-0 bottom-3 text-center font-mono text-2xl font-black tabular-nums text-[#7dffb2]">
        {String(value).padStart(2, '0')}
      </span>
    </div>
  );
}

const LAMP_TEXT: Record<ValveLamp, string> = { off: 'Off', steady: 'Steady', pulsing: 'Pulsing' };

/** The valve lamp: Off, Steady or Pulsing, with its name so it never relies on light alone. */
export function Lamp({ lamp }: { lamp: ValveLamp }) {
  return (
    <span className="inline-flex items-center gap-2" data-lamp={lamp}>
      <span
        className={`h-4 w-4 rounded-full border-2 ${
          lamp === 'off'
            ? 'border-[#4b5385] bg-transparent'
            : lamp === 'steady'
              ? 'border-[#ffc53d] bg-[#ffc53d] shadow-[0_0_10px_#ffc53d]'
              : 'animate-pulse border-[#ffc53d] bg-[#ffc53d] shadow-[0_0_10px_#ffc53d]'
        }`}
        aria-hidden
      />
      <span className="font-bold">{LAMP_TEXT[lamp]}</span>
    </span>
  );
}

/** Three fault pips (spec 12). */
export function FaultPips({ faults }: { faults: number }) {
  return (
    <span
      className="inline-flex gap-1.5"
      role="img"
      aria-label={`${faults} of ${MAX_FAULTS} faults`}
      data-testid="fault-pips"
      data-faults={faults}
    >
      {Array.from({ length: MAX_FAULTS }, (_, i) => (
        <span
          key={i}
          className={`h-3.5 w-3.5 rounded-full border-2 ${i < faults ? 'border-danger bg-danger' : 'border-muted/50'}`}
        />
      ))}
    </span>
  );
}

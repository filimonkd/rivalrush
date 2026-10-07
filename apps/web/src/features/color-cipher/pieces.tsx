import { CC_COLORS } from '@rivalrush/shared';
import { haptic } from '../../lib/telegram';
import { FILL, INK } from './palette';

/**
 * Color Cipher's visual language: rounded gem tiles, each color with its own symbol (so the game
 * never relies on hue alone), and diamond feedback pips.
 */

const SIZES = {
  lg: 'h-16 w-16 rounded-2xl text-2xl',
  md: 'h-11 w-11 rounded-xl text-lg',
  sm: 'h-8 w-8 rounded-lg text-sm',
} as const;

function colorName(id: number): string {
  return CC_COLORS[id]?.name ?? 'Empty';
}

export function Tile({
  color,
  size = 'md',
  active,
}: {
  color: number | null;
  size?: keyof typeof SIZES;
  active?: boolean;
}) {
  if (color === null) {
    return (
      <span
        className={`grid place-items-center border-2 border-dashed border-muted/30 bg-surface ${SIZES[size]} ${active ? 'ring-2 ring-accent/70' : ''}`}
        aria-label="Empty"
      />
    );
  }
  return (
    <span
      className={`grid animate-pop place-items-center font-black shadow-[inset_0_-4px_0_rgba(0,0,0,0.18)] ${SIZES[size]}`}
      style={{ backgroundColor: FILL[color], color: INK[color] }}
      aria-label={colorName(color)}
      data-color={color}
    >
      {CC_COLORS[color]?.symbol}
    </span>
  );
}

/** A pattern as tiles; `value` is a string of color ids ("0312"), shorter while being built. */
export function PatternRow({
  value,
  length,
  size = 'md',
  shake,
  testId,
}: {
  value: string;
  length: number;
  size?: keyof typeof SIZES;
  shake?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={`flex justify-center gap-2 ${shake ? 'animate-shake' : ''}`}
      data-testid={testId}
      aria-label={
        value
          ? Array.from(value)
              .map((c) => colorName(Number(c)))
              .join(', ')
          : undefined
      }
    >
      {Array.from({ length }, (_, i) => (
        <Tile
          key={i}
          color={value[i] !== undefined ? Number(value[i]) : null}
          size={size}
          active={i === value.length}
        />
      ))}
    </div>
  );
}

/** Six big color buttons plus Undo / Clear. Colors may repeat. */
export function Palette({
  value,
  length,
  onChange,
  disabled,
}: {
  value: string;
  length: number;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const full = value.length >= length;
  return (
    <div className="flex flex-col gap-2" data-testid="palette">
      <div className="grid grid-cols-6 gap-2">
        {CC_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            data-color={c.id}
            aria-label={c.name}
            disabled={disabled || full}
            onClick={() => {
              haptic.select();
              onChange(value + String(c.id));
            }}
            className="grid aspect-square place-items-center rounded-2xl text-xl font-black shadow-[inset_0_-4px_0_rgba(0,0,0,0.18)] transition active:scale-90 disabled:opacity-35"
            style={{ backgroundColor: FILL[c.id], color: INK[c.id] }}
          >
            {c.symbol}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled || !value}
          onClick={() => {
            haptic.select();
            onChange(value.slice(0, -1));
          }}
          className="h-11 rounded-2xl bg-surface text-sm font-bold text-muted disabled:opacity-30"
        >
          Undo
        </button>
        <button
          type="button"
          disabled={disabled || !value}
          onClick={() => onChange('')}
          className="h-11 rounded-2xl bg-surface text-sm font-bold text-muted disabled:opacity-30"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

/** Exact = filled diamond, Close = outlined diamond, miss = faint dot. Counts, not positions. */
export function FeedbackPips({
  exact,
  partial,
  length,
}: {
  exact: number;
  partial: number;
  length: number;
}) {
  const pips = Array.from({ length }, (_, i) =>
    i < exact ? 'exact' : i < exact + partial ? 'close' : 'miss',
  );
  return (
    <div
      className="grid grid-cols-2 gap-1"
      aria-label={`${exact} exact, ${partial} close`}
      data-testid="feedback"
    >
      {pips.map((p, i) => (
        <span
          key={i}
          className={`h-3 w-3 rotate-45 rounded-[3px] ${p === 'exact' ? 'bg-bull' : p === 'close' ? 'border-[2.5px] border-cow' : 'bg-muted/20'}`}
        />
      ))}
    </div>
  );
}

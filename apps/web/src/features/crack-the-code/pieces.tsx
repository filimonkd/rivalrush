import { haptic } from '../../lib/telegram';

/** Bulls = solid green pegs, cows = amber rings. */
export function Pegs({ bulls, cows, length }: { bulls: number; cows: number; length: number }) {
  const pegs = Array.from({ length }, (_, i) =>
    i < bulls ? 'bull' : i < bulls + cows ? 'cow' : 'none',
  );
  return (
    <div className="flex items-center gap-1" aria-label={`${bulls} bulls, ${cows} cows`}>
      {pegs.map((p, i) => (
        <span
          key={i}
          className={`h-3.5 w-3.5 rounded-full ${p === 'bull' ? 'bg-bull' : p === 'cow' ? 'border-[3px] border-cow' : 'bg-muted/25'}`}
        />
      ))}
    </div>
  );
}

export function CodeSlots({
  value,
  length,
  hidden,
  shake,
  size = 'lg',
}: {
  value: string;
  length: number;
  hidden?: boolean;
  shake?: boolean;
  size?: 'lg' | 'sm';
}) {
  const box = size === 'lg' ? 'h-16 w-14 text-4xl rounded-2xl' : 'h-9 w-8 text-xl rounded-xl';
  return (
    <div
      className={`flex justify-center gap-2 ${shake ? 'animate-shake' : ''}`}
      data-testid="code-slots"
    >
      {Array.from({ length }, (_, i) => {
        const ch = value[i];
        return (
          <div
            key={i}
            className={`grid place-items-center bg-surface font-black tabular-nums ${box} ${ch ? 'animate-pop text-text' : 'text-muted/40'} ${i === value.length ? 'ring-2 ring-accent/70' : ''}`}
          >
            {ch ? (hidden ? '•' : ch) : '·'}
          </div>
        );
      })}
    </div>
  );
}

/** Vault-dial keypad: digits already used in the current code are disabled (no repeats). */
export function Keypad({
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
  const press = (d: string) => {
    if (disabled || value.length >= length || value.includes(d)) return;
    haptic.select();
    onChange(value + d);
  };
  const back = () => {
    if (disabled || !value) return;
    haptic.select();
    onChange(value.slice(0, -1));
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
  return (
    <div className="grid grid-cols-3 gap-2" data-testid="keypad">
      {keys.map((k) => {
        if (k === 'clear')
          return (
            <button
              key={k}
              type="button"
              disabled={disabled || !value}
              onClick={() => onChange('')}
              className="h-14 rounded-2xl text-sm font-bold text-muted disabled:opacity-30"
            >
              Clear
            </button>
          );
        if (k === 'back')
          return (
            <button
              key={k}
              type="button"
              aria-label="Delete"
              disabled={disabled || !value}
              onClick={back}
              className="h-14 rounded-2xl text-2xl font-bold text-muted disabled:opacity-30"
            >
              ⌫
            </button>
          );
        const used = value.includes(k);
        return (
          <button
            key={k}
            type="button"
            data-digit={k}
            disabled={disabled || used || value.length >= length}
            onClick={() => press(k)}
            className="h-14 rounded-2xl bg-surface text-2xl font-black tabular-nums transition active:scale-95 disabled:opacity-30"
          >
            {k}
          </button>
        );
      })}
    </div>
  );
}

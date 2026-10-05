import { useToasts } from '../store/toasts';

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4"
      style={{ top: 'calc(var(--rr-safe-top) + 8px)' }}
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          data-testid="toast"
          className={`animate-rise rounded-2xl px-4 py-2 text-sm font-bold shadow-xl ${
            t.kind === 'good'
              ? 'bg-bull text-white'
              : t.kind === 'bad'
                ? 'bg-danger text-white'
                : 'bg-text text-bg'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

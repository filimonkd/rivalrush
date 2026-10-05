/** Circular countdown driven by server deadlines. */
export function TimerRing({
  remainingMs,
  totalMs,
  urgent,
}: {
  remainingMs: number | null;
  totalMs: number;
  urgent?: boolean;
}) {
  const fraction = remainingMs === null ? 0 : Math.max(0, Math.min(1, remainingMs / totalMs));
  const r = 20;
  const c = 2 * Math.PI * r;
  const secs = remainingMs === null ? '' : Math.ceil(remainingMs / 1000);
  return (
    <div className="relative grid h-14 w-14 place-items-center" data-testid="timer">
      <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" strokeWidth="5" className="stroke-muted/20" />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - fraction)}
          className={`transition-[stroke-dashoffset] duration-300 ${urgent ? 'stroke-danger' : 'stroke-accent'}`}
        />
      </svg>
      <span className={`text-lg font-black tabular-nums ${urgent ? 'text-danger' : ''}`}>
        {secs}
      </span>
    </div>
  );
}

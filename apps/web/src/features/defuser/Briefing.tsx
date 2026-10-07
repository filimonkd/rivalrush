import type { PlayerSeat } from '@rivalrush/shared';
import { Button } from '../../components/ui';
import { indexRows, roleLabel, type AnalystView, type OperatorView } from './model';

/**
 * The briefing (spec 19, row 2): a full-screen role card and a Ready button. No Charge and no sheet
 * contents exist yet (the server sends none), and the clock only starts when the server arms the
 * device: this screen never starts anything itself.
 */
export function Briefing({
  view,
  seats,
  nameOf,
  busy,
  onReady,
}: {
  view: OperatorView | AnalystView;
  seats: readonly PlayerSeat[];
  nameOf: (userId: string) => string;
  busy: boolean;
  onReady: () => void;
}) {
  const me = view.roster.find((r) => r.userId === view.me);
  const ready = me?.ready ?? false;
  const waiting = view.roster.filter(
    (r) => r.status === 'active' && !r.ready && r.userId !== view.me,
  );
  const rows = indexRows(view);
  const mine = rows.filter((r) => r.mine);
  const othersHolders = [...new Set(rows.filter((r) => !r.mine).flatMap((r) => r.holders))].filter(
    (id) => id !== view.me,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="briefing">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {view.kind === 'operator' ? (
          <div
            className="shrink-0 rounded-3xl border border-[#2a3158] bg-[#10142a] p-4 text-[#e8ebff]"
            data-testid="briefing-operator"
          >
            <p className="text-xs font-black tracking-widest text-[#f5a524]">YOUR ROLE</p>
            <h1 className="mt-1 text-2xl font-black">
              You are the <span className="text-[#f5a524]">OPERATOR</span>.
            </h1>
            <p className="mt-3 text-lg font-bold">Only you see the Charge.</p>
            <p className="mt-1 text-[#b6bce0]">Describe it; your team tells you what to do.</p>
            <p className="mt-3 text-sm text-[#7d86b8]">
              You see the Charge. You can&apos;t see the Codebook.
            </p>
          </div>
        ) : (
          <div
            className="shrink-0 rounded-3xl border border-[#e2dbc3] bg-[#faf6ea] p-4 text-[#1c1a14]"
            data-testid="briefing-analyst"
          >
            <p className="text-xs font-black tracking-widest text-[#0b7c86]">YOUR ROLE</p>
            <h1 className="mt-1 text-2xl font-black">
              You are{' '}
              <span className="text-[#0b7c86]">{me ? roleLabel(me).toUpperCase() : 'ANALYST'}</span>
              .
            </h1>
            <p className="mt-3 text-lg font-bold" data-testid="briefing-sheet-count">
              You hold {mine.length} of {rows.length} sheets.
            </p>
            {othersHolders.length > 0 && (
              <p className="mt-1 text-[#5c563f]">
                {othersHolders.map(nameOf).join(' and ')}{' '}
                {othersHolders.length > 1 ? 'hold' : 'holds'} the rest.
              </p>
            )}
            <ul className="mt-3 flex flex-col gap-1" data-testid="briefing-sheets">
              {mine.map((r) => (
                <li
                  key={r.sheet}
                  className="rounded-lg bg-white/70 px-2 py-1 text-[15px] font-bold"
                >
                  {r.title}
                </li>
              ))}
            </ul>
          </div>
        )}

        <section className="shrink-0 rounded-2xl bg-card p-3" aria-label="Team">
          <ul className="flex flex-col gap-1.5" data-testid="briefing-roster">
            {view.roster.map((r) => {
              const seat = seats.find((s) => s.userId === r.userId);
              return (
                <li key={r.userId} className="flex items-center justify-between gap-2 text-[15px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${seat?.online ? 'bg-bull' : 'bg-danger'}`}
                      aria-hidden
                    />
                    <span className="truncate font-bold">
                      {r.userId === view.me ? 'You' : nameOf(r.userId)}
                    </span>
                    <span className="shrink-0 text-muted">· {roleLabel(r)}</span>
                  </span>
                  <span
                    className={`shrink-0 text-xs font-black ${r.ready ? 'text-bull' : 'text-muted'}`}
                  >
                    {r.ready ? '✓ Ready' : 'Not ready'}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <p className="text-center text-sm text-muted">
          Best on a voice call. The clock starts when everyone is ready.
        </p>
      </div>
      <div className="shrink-0">
        <Button onClick={onReady} disabled={busy || ready} data-testid="ready">
          {ready
            ? waiting.length > 0
              ? `Waiting for ${waiting.length} more…`
              : 'Starting…'
            : "I'm ready"}
        </Button>
      </div>
    </div>
  );
}

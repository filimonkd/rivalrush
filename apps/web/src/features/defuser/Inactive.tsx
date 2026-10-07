import { Button } from '../../components/ui';
import { indexRows, sheetTitle, wasStartingOperator, type InactiveView } from './model';

/**
 * After a time-out: no Charge, no sheets. The server says whether a rejoin is possible
 * (during ARMED); the wording follows spec 19, row 12.
 */
export function InactiveScreen({
  view,
  nameOf,
  onRejoin,
  onLeave,
  busy,
}: {
  view: InactiveView;
  nameOf: (userId: string) => string;
  onRejoin: () => void;
  onLeave: () => void;
  busy: boolean;
}) {
  const operator = view.roster.find((r) => r.role === 'operator');
  const wasOperator = wasStartingOperator(view.roster, view.me);
  const rows = indexRows(view);
  // Who holds the sheets this player would get copies of, read from the public index.
  const holders = [
    ...new Set(view.initialSheets.flatMap((id) => rows.find((r) => r.sheet === id)?.holders ?? [])),
  ].filter((id) => id !== view.me);
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4 text-center"
      data-testid="inactive-screen"
    >
      <p className="text-5xl" aria-hidden>
        ⏱️
      </p>
      <h1 className="text-2xl font-black">You were away too long</h1>
      <p className="max-w-xs text-muted">
        {wasOperator
          ? operator
            ? `${nameOf(operator.userId)} took over as Operator. ${view.canRejoin ? 'Rejoin as an Analyst?' : ''}`
            : 'The team carried on without you.'
          : holders.length > 0
            ? `Your sheets (${view.initialSheets.map(sheetTitle).join(', ')}) went to ${holders.map(nameOf).join(', ')}. ${view.canRejoin ? 'Rejoin to get copies back?' : ''}`
            : 'The team carried on without you.'}
      </p>
      {view.canRejoin ? (
        <Button onClick={onRejoin} disabled={busy} data-testid="rejoin">
          Rejoin as an Analyst
        </Button>
      ) : (
        <p className="text-sm text-muted" data-testid="rejoin-closed">
          You can rejoin once the Charge is armed.
        </p>
      )}
      <Button variant="danger" big={false} onClick={onLeave}>
        Leave the team
      </Button>
    </div>
  );
}

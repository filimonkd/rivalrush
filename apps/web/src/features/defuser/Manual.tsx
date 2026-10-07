import { renderSheet, sheetInfo, type SheetData, type SheetId } from '@rivalrush/shared';
import { useState } from 'react';
import { haptic } from '../../lib/telegram';
import { indexRows, panelName, type AnalystView, type View } from './model';

/**
 * The Analyst's manual: paper, not device. Each sheet is formatted by the shared sheet renderer
 * (the same wording the tests pin), so the browser never re-states a rule or solves anything.
 */

const PAPER = 'rounded-2xl border border-[#e2dbc3] bg-[#faf6ea] text-[#1c1a14] shadow-sm';

/** One sheet, from its rule data. */
export function SheetView({ sheet }: { sheet: SheetData }) {
  const r = renderSheet(sheet);
  const info = sheetInfo(sheet.id);
  return (
    <article className={`${PAPER} shrink-0 p-3`} data-testid="sheet" data-sheet={sheet.id}>
      <header className="mb-2 flex items-baseline justify-between gap-2 border-b border-[#e2dbc3] pb-1.5">
        <h2 className="text-base font-black">{r.title}</h2>
        <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-[#7a735c]">
          {info.type === 'procedure' ? 'Procedure' : 'Reference'}
        </span>
      </header>
      {r.items.length > 0 && (
        <ol className="flex list-none flex-col gap-1.5 text-[15px] leading-snug">
          {r.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      )}
      {r.table && (
        <table className="w-full border-collapse text-[15px]">
          <thead>
            <tr>
              {r.table.header.map((h, i) => (
                <th
                  key={i}
                  className="border-b-2 border-[#1c1a14] px-1.5 py-1 text-left text-xs font-black uppercase tracking-wide"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.table.rows.map((row, i) => (
              <tr key={i} className="border-b border-[#e2dbc3] last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className={`px-1.5 py-1 ${j === 0 ? 'font-bold' : 'tabular-nums'}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {r.note && <p className="mt-2 text-[15px] italic text-[#5c563f]">{r.note}</p>}
    </article>
  );
}

/**
 * The sheet index: all six sheets with their holders, and nothing else. It is built from the
 * metadata every player already has, so it never shows content of a sheet the viewer lacks.
 */
export function SheetIndex({
  view,
  nameOf,
}: {
  view: View;
  /** Display name for a user id ("You" for the viewer is added here). */
  nameOf: (userId: string) => string;
}) {
  const rows = indexRows(view);
  return (
    <section
      className={`${PAPER} p-2.5`}
      data-testid="sheet-index"
      aria-label="Who holds which sheet"
    >
      <h3 className="mb-1 text-xs font-black uppercase tracking-wide text-[#7a735c]">
        Sheet index
      </h3>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li
            key={r.sheet}
            data-sheet={r.sheet}
            data-mine={r.mine}
            className="flex items-baseline justify-between gap-2 border-b border-[#e2dbc3] py-1 text-[14px] last:border-0"
          >
            <span className={`min-w-0 truncate ${r.mine ? 'font-black' : ''}`}>
              {r.solved && <span className="mr-1 text-[#1f8a4c]">✓</span>}
              {r.title}
            </span>
            <span className="shrink-0 font-bold text-[#5c563f]" data-testid="holder">
              {r.holders.length === 0
                ? '→ —'
                : `→ ${r.holders.map((h) => (h === view.me ? 'You' : nameOf(h))).join(', ')}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The Analyst's main screen: tabs for their own sheets, then the index. */
export function AnalystManual({
  view,
  nameOf,
}: {
  view: AnalystView;
  nameOf: (userId: string) => string;
}) {
  const [picked, setPicked] = useState<SheetId | null>(null);
  const sheets = view.sheets;
  const active = sheets.find((s) => s.id === picked) ?? sheets[0] ?? null;
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
      data-testid="analyst-manual"
    >
      {sheets.length > 0 ? (
        <>
          <div
            className="flex shrink-0 gap-1.5 overflow-x-auto pb-0.5"
            role="tablist"
            aria-label="Your sheets"
            data-testid="sheet-tabs"
          >
            {sheets.map((s) => {
              const info = sheetInfo(s.id);
              const on = active?.id === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  data-testid={`sheet-tab-${s.id}`}
                  onClick={() => {
                    haptic.select();
                    setPicked(s.id);
                  }}
                  className={`flex h-12 shrink-0 flex-col items-start justify-center rounded-xl px-3 text-left leading-tight transition ${
                    on ? 'bg-[#0b7c86] text-white' : 'bg-card text-text'
                  }`}
                >
                  <span className="text-[10px] font-bold uppercase opacity-75">
                    {view.solved[info.panel] ? '✓ ' : ''}
                    {panelName(info.panel)}
                  </span>
                  <span className="text-sm font-black">{info.tabLabel}</span>
                </button>
              );
            })}
          </div>
          {active && <SheetView sheet={active} />}
        </>
      ) : (
        <p className={`${PAPER} shrink-0 p-4 text-[15px]`} data-testid="no-sheets">
          You hold no sheets right now. The index shows who has them.
        </p>
      )}
      <SheetIndex view={view} nameOf={nameOf} />
    </div>
  );
}

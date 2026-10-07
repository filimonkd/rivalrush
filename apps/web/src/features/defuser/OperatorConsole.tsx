import { PANEL_IDS, type DefuserPlayerAction, type PanelId, type Vent } from '@rivalrush/shared';
import { useEffect, useRef, useState } from 'react';
import { haptic } from '../../lib/telegram';
import { FuseBoard, GlyphBoard, ValveBoard } from './boards';
import { panelName, type OperatorView } from './model';

/** Sends one intent; resolves true if the server accepted it. The client never judges the result. */
export type ActFn = (action: DefuserPlayerAction) => Promise<boolean>;

const PLATE = 'rounded-3xl border border-[#2a3158] bg-[#10142a] text-[#e8ebff]';

export function PanelTabs({
  solved,
  active,
  onPick,
}: {
  solved: Record<PanelId, boolean>;
  active: PanelId;
  onPick: (p: PanelId) => void;
}) {
  return (
    <div
      className="grid grid-cols-3 gap-2"
      role="tablist"
      aria-label="Panels"
      data-testid="panel-tabs"
    >
      {PANEL_IDS.map((p) => (
        <button
          key={p}
          type="button"
          role="tab"
          aria-selected={active === p}
          data-testid={`tab-${p}`}
          data-solved={solved[p]}
          onClick={() => {
            haptic.select();
            onPick(p);
          }}
          className={`flex h-12 items-center justify-center gap-1 rounded-xl text-sm font-black transition ${
            active === p ? 'bg-[#f5a524] text-[#2a1a00]' : 'bg-card text-text'
          }`}
        >
          {solved[p] && <span aria-hidden>✓</span>}
          {panelName(p)}
        </button>
      ))}
    </div>
  );
}

export function SolvedBanner({ panel }: { panel: PanelId }) {
  return (
    <p
      className="rounded-xl bg-bull px-3 py-2 text-center font-black text-white"
      data-testid="solved-banner"
    >
      ✓ {panelName(panel)} solved
    </p>
  );
}

/** The Operator's screen: three panel tabs and one device panel filling the space. */
export function OperatorConsole({ view, act }: { view: OperatorView; act: ActFn }) {
  const charge = view.charge;
  const [panel, setPanel] = useState<PanelId>(
    () => PANEL_IDS.find((p) => !view.solved[p]) ?? 'fuse',
  );
  const [picked, setPicked] = useState<number | null>(null);
  const [level, setLevel] = useState(1);
  const [vent, setVent] = useState<Vent>('seal');
  const [busy, setBusy] = useState(false);

  // A wrong valve commit resets the controls to level 1 / SEAL (spec 5.3).
  const triedValve = view.tried.valve.length;
  const prevTried = useRef(triedValve);
  useEffect(() => {
    if (triedValve > prevTried.current) {
      setLevel(1);
      setVent('seal');
    }
    prevTried.current = triedValve;
  }, [triedValve]);

  if (!charge) return null;
  // A line that has since been cut (or a solved panel) can no longer be selected.
  const selected =
    picked !== null && !view.cutLines.includes(picked) && !view.solved.fuse ? picked : null;

  const send = async (action: DefuserPlayerAction) => {
    if (busy) return;
    setBusy(true);
    const ok = await act(action);
    setBusy(false);
    return ok;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5" data-testid="operator-console">
      <PanelTabs solved={view.solved} active={panel} onPick={setPanel} />
      <section
        className={`flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-2.5 ${PLATE}`}
        data-testid={`panel-${panel}`}
      >
        {view.solved[panel] && <SolvedBanner panel={panel} />}

        {panel === 'fuse' && (
          <>
            <FuseBoard
              charge={charge.fuse}
              cutLines={view.cutLines}
              selected={selected}
              solved={view.solved.fuse}
              onSelect={(n) => {
                haptic.select();
                setPicked(n === picked ? null : n);
              }}
            />
            <button
              type="button"
              data-testid="cut-line"
              disabled={selected === null || busy || view.solved.fuse}
              onClick={async () => {
                if (selected === null) return;
                haptic.press();
                await send({ type: 'CUT_LINE', line: selected });
                setPicked(null);
              }}
              className="mt-auto h-14 w-full shrink-0 rounded-2xl bg-[#ff5470] text-lg font-black text-white transition active:scale-[0.97] disabled:bg-[#232a52] disabled:text-[#7d86b8] disabled:active:scale-100"
            >
              {view.solved.fuse
                ? 'Done'
                : selected === null
                  ? 'Tap a line, then cut it'
                  : `Cut line ${selected}`}
            </button>
          </>
        )}

        {panel === 'glyph' && (
          <GlyphBoard
            charge={charge.glyph}
            litKey={view.litKey}
            tried={view.tried.glyph}
            solved={view.solved.glyph}
            onPress={(key) => {
              haptic.press();
              void send({ type: 'PRESS_GLYPH', key });
            }}
          />
        )}

        {panel === 'valve' && (
          <ValveBoard
            charge={charge.valve}
            level={level}
            vent={vent}
            tried={view.tried.valve}
            solved={view.solved.valve}
            onLevel={(l) => {
              haptic.select();
              setLevel(l);
            }}
            onVent={(v) => {
              haptic.select();
              setVent(v);
            }}
            onCommit={() => void send({ type: 'SET_VALVE', level, vent })}
          />
        )}
      </section>
    </div>
  );
}

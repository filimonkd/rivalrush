import { useState } from 'react';
import { gameInfo } from '../lib/games';
import { howToFor, markHowToSeen } from '../lib/howto';
import { haptic } from '../lib/telegram';

const TONES = {
  defuser: { label: 'text-[#f5a524]', dot: 'bg-[#f5a524]', next: 'bg-[#f5a524] text-[#2a1a00]' },
  duel: { label: 'text-accent', dot: 'bg-accent', next: 'bg-accent text-accent-text' },
} as const;

/**
 * A short, skippable explainer for first-time players of a game. Closing it (any way) counts as
 * seen for that game on this device. `settings` puts the room's own numbers into the steps.
 */
export function HowToPlay({
  gameId,
  settings,
  onClose,
}: {
  gameId: string;
  settings?: Record<string, unknown>;
  onClose: () => void;
}) {
  const [i, setI] = useState(0);
  const howTo = howToFor(gameId);
  const steps = howTo.steps(settings);
  const tone = TONES[howTo.tone];
  const step = steps[i]!;
  const last = i === steps.length - 1;
  const close = () => {
    markHowToSeen(gameId);
    onClose();
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`How to play ${gameInfo(gameId).name}`}
      data-testid="how-to-play"
    >
      <div
        className="flex max-h-[92%] w-full max-w-md animate-rise flex-col gap-3 rounded-t-[2rem] bg-bg p-5 sm:rounded-[2rem]"
        style={{ paddingBottom: 'calc(var(--rr-safe-bottom) + 20px)' }}
      >
        <div className="flex items-center justify-between">
          <p className={`text-xs font-black uppercase tracking-widest ${tone.label}`}>
            How to play · {i + 1} of {steps.length}
          </p>
          {!last && (
            <button
              type="button"
              onClick={close}
              className="h-9 px-2 text-sm font-bold text-muted"
              data-testid="howto-skip"
            >
              Skip
            </button>
          )}
        </div>
        <div className="min-h-0 overflow-y-auto" data-testid="howto-step" data-step={i + 1}>
          <h2 className="text-2xl font-black">{step.title}</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {step.lines.map((line) => (
              <li key={line} className="text-[15px] leading-snug">
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center justify-center gap-1.5" aria-hidden>
          {steps.map((_, n) => (
            <span
              key={n}
              className={`h-2 rounded-full transition-all ${n === i ? `w-5 ${tone.dot}` : 'w-2 bg-muted/40'}`}
            />
          ))}
        </div>
        <div className="flex gap-2">
          {i > 0 && (
            <button
              type="button"
              onClick={() => setI(i - 1)}
              className="h-12 flex-1 rounded-2xl bg-card font-bold"
              data-testid="howto-back"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              haptic.select();
              if (last) close();
              else setI(i + 1);
            }}
            className={`h-12 flex-[2] rounded-2xl font-black ${tone.next}`}
            data-testid={last ? 'howto-done' : 'howto-next'}
          >
            {last ? 'Got it' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "How to play" button (or a compact text link) that opens the game's explainer. */
export function HowToPlayButton({
  gameId,
  settings,
  link = false,
  className = '',
}: {
  gameId: string;
  settings?: Record<string, unknown>;
  link?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${link ? 'text-sm' : 'h-11 rounded-2xl px-4'} font-bold text-link ${className}`}
        data-testid="open-how-to-play"
      >
        How to play
      </button>
      {open && <HowToPlay gameId={gameId} settings={settings} onClose={() => setOpen(false)} />}
    </>
  );
}

import { useState } from 'react';
import { haptic } from '../../lib/telegram';
import { HOW_TO_STEPS, markHowToSeen } from './howto';

/** A short, skippable explainer for first-time teams. Closing it (any way) counts as seen. */
export function HowToPlay({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const step = HOW_TO_STEPS[i]!;
  const last = i === HOW_TO_STEPS.length - 1;
  const close = () => {
    markHowToSeen();
    onClose();
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="How to play Defuser"
      data-testid="how-to-play"
    >
      <div
        className="flex max-h-[92%] w-full max-w-md animate-rise flex-col gap-3 rounded-t-[2rem] bg-bg p-5 sm:rounded-[2rem]"
        style={{ paddingBottom: 'calc(var(--rr-safe-bottom) + 20px)' }}
      >
        <div className="flex items-center justify-between">
          <p className="text-xs font-black uppercase tracking-widest text-[#f5a524]">
            How to play · {i + 1} of {HOW_TO_STEPS.length}
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
          {HOW_TO_STEPS.map((_, n) => (
            <span
              key={n}
              className={`h-2 rounded-full transition-all ${n === i ? 'w-5 bg-[#f5a524]' : 'w-2 bg-muted/40'}`}
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
            className="h-12 flex-[2] rounded-2xl bg-[#f5a524] font-black text-[#2a1a00]"
            data-testid={last ? 'howto-done' : 'howto-next'}
          >
            {last ? 'Got it' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "How to play" link that opens the explainer. */
export function HowToPlayButton({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`h-11 rounded-2xl px-4 font-bold text-link ${className}`}
        data-testid="open-how-to-play"
      >
        How to play
      </button>
      {open && <HowToPlay onClose={() => setOpen(false)} />}
    </>
  );
}

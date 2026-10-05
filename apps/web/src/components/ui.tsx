import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { haptic } from '../lib/telegram';

export function Screen({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <main
      className={`mx-auto flex min-h-full w-full max-w-md flex-col px-4 ${className}`}
      style={{
        paddingTop: 'calc(var(--rr-safe-top) + 12px)',
        paddingBottom: 'calc(var(--rr-safe-bottom) + 16px)',
      }}
    >
      {children}
    </main>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-text shadow-lg shadow-accent/25',
  secondary: 'bg-card text-text',
  ghost: 'bg-transparent text-link',
  danger: 'bg-transparent text-danger',
};

export function Button({
  variant = 'primary',
  big = true,
  className = '',
  onClick,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; big?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      onClick={(e) => {
        haptic.tap();
        onClick?.(e);
      }}
      className={`${big ? 'h-14 text-lg' : 'h-11 text-base'} w-full rounded-2xl px-5 font-bold tracking-tight transition active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-3xl bg-card p-4 ${className}`}>{children}</section>;
}

export function Avatar({
  name,
  url,
  size = 44,
  ring,
}: {
  name: string;
  url: string | null;
  size?: number;
  ring?: boolean;
}) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-accent/20 font-bold text-accent ${ring ? 'ring-4 ring-accent/60' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        initials
      )}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 text-muted">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent/25 border-t-accent" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}

export function Pill({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'accent' | 'good' | 'bad';
}) {
  const tones = {
    muted: 'bg-surface text-muted',
    accent: 'bg-accent/15 text-accent',
    good: 'bg-bull/15 text-bull',
    bad: 'bg-danger/15 text-danger',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Logo({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <img src="/icon.svg" alt="" className={small ? 'h-7 w-7' : 'h-10 w-10'} />
      <span className={`font-black tracking-tight ${small ? 'text-lg' : 'text-3xl'}`}>
        RivalRush
      </span>
    </div>
  );
}

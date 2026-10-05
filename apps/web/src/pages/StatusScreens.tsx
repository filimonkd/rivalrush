import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, Logo, Screen, Spinner } from '../components/ui';
import { useSession } from '../store/session';

export function LoadingScreen() {
  // The free-tier server sleeps when idle; the first request can take up to a minute.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, []);
  return (
    <Screen className="items-center justify-center gap-8 text-center">
      <Logo />
      <Spinner />
      {slow ? (
        <p className="max-w-xs text-sm text-muted" data-testid="waking-server">
          Waking up the game server… this can take up to a minute after a quiet spell.
        </p>
      ) : (
        <p className="text-sm text-muted">Quick games. Real rivals.</p>
      )}
    </Screen>
  );
}

export function OpenInTelegramPage() {
  const bot = import.meta.env.VITE_BOT_USERNAME;
  return (
    <Screen className="items-center justify-center gap-6 text-center">
      <Logo />
      <p className="text-lg font-bold">RivalRush lives inside Telegram.</p>
      <p className="text-muted">Open the bot and tap Play — you'll be signed in automatically.</p>
      {bot && (
        <a className="w-full" href={`https://t.me/${bot}`}>
          <Button>Open @{bot}</Button>
        </a>
      )}
    </Screen>
  );
}

/** Local development only (VITE_DEV_LOGIN=true and the server's DEV_LOGIN_ENABLED). */
export function DevLoginPage() {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Screen className="justify-center gap-4">
      <Logo />
      <p className="text-muted">Development sign-in (not available in production).</p>
      <input
        aria-label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        className="h-14 rounded-2xl bg-surface px-4 text-lg outline-none ring-accent focus:ring-2"
      />
      {error && <p className="text-danger">{error}</p>}
      <Button
        disabled={!name.trim()}
        onClick={() =>
          useSession
            .getState()
            .devLogin(name.trim())
            .catch((e: Error) => setError(e.message))
        }
      >
        Sign in
      </Button>
    </Screen>
  );
}

export function ErrorScreen({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Screen className="items-center justify-center gap-4 text-center">
      <div className="text-5xl">😵‍💫</div>
      <h1 className="text-2xl font-black" data-testid="error-title">
        {title}
      </h1>
      <p className="text-muted">{message}</p>
      <div className="mt-4 flex w-full flex-col gap-2">
        {onRetry && <Button onClick={onRetry}>Try again</Button>}
        <Link to="/" className="w-full">
          <Button variant="secondary">Home</Button>
        </Link>
      </div>
    </Screen>
  );
}

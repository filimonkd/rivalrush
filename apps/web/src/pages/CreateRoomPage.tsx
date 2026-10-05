import { CTC_LIMITS, type RoomSnapshot } from '@rivalrush/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card, Screen } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { haptic } from '../lib/telegram';
import { useBackButton } from '../lib/useBackButton';
import { useRoom } from '../store/room';

function Segmented<T extends number>({
  label,
  hint,
  options,
  value,
  onChange,
  format = String,
  testId,
}: {
  label: string;
  hint: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
  testId: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="font-black">{label}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <div
        className="mt-2 grid gap-2"
        style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
        data-testid={testId}
      >
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={o === value}
            onClick={() => {
              haptic.select();
              onChange(o);
            }}
            className={`h-12 rounded-2xl text-lg font-black transition ${o === value ? 'bg-accent text-accent-text' : 'bg-surface text-text'}`}
          >
            {format(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CreateRoomPage() {
  useBackButton('/');
  const navigate = useNavigate();
  const [codeLength, setCodeLength] = useState<number>(CTC_LIMITS.codeLength.default);
  const [turnSeconds, setTurnSeconds] = useState<number>(CTC_LIMITS.turnSeconds.default);
  const [maxGuesses, setMaxGuesses] = useState<number>(CTC_LIMITS.maxGuesses.default);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const room = await api<RoomSnapshot>('/rooms', {
        method: 'POST',
        body: { gameType: 'crack-the-code', settings: { codeLength, turnSeconds, maxGuesses } },
      });
      haptic.success();
      await useRoom.getState().enter(room.roomId, room);
      navigate(`/room/${room.roomId}`, { replace: true });
    } catch (e) {
      haptic.error();
      setError(e instanceof ApiError ? e.message : 'Could not create the room.');
      setBusy(false);
    }
  };

  return (
    <Screen className="gap-4">
      <h1 className="text-3xl font-black">New duel</h1>

      <Card className="flex items-center gap-3 border-2 border-accent">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent text-xl font-black text-accent-text">
          #
        </div>
        <div>
          <p className="font-black">Crack the Code</p>
          <p className="text-sm text-muted">2 players · hide a code, crack theirs first</p>
        </div>
      </Card>

      <Card className="flex flex-col gap-5">
        <Segmented
          testId="opt-length"
          label="Code length"
          hint="Fewer digits = faster games"
          options={[3, 4, 5] as const}
          value={codeLength as 3 | 4 | 5}
          onChange={setCodeLength}
        />
        <Segmented
          testId="opt-turn"
          label="Turn time"
          hint="Time to make each guess"
          options={[30, 45, 60, 90] as const}
          value={turnSeconds as 30 | 45 | 60 | 90}
          onChange={setTurnSeconds}
          format={(v) => `${v}s`}
        />
        <Segmented
          testId="opt-guesses"
          label="Guesses each"
          hint="Both out of guesses = draw"
          options={[8, 10, 12] as const}
          value={maxGuesses as 8 | 10 | 12}
          onChange={setMaxGuesses}
        />
      </Card>

      <Card className="text-sm text-muted">
        <p>
          <span className="font-bold text-bull">● Bull</span> = right digit, right place.{' '}
          <span className="font-bold text-cow">○ Cow</span> = right digit, wrong place. Digits never
          repeat. If the first player cracks it, the second gets one last guess to tie.
        </p>
      </Card>

      {error && <p className="text-center font-bold text-danger">{error}</p>}
      <div className="mt-auto">
        <Button onClick={create} disabled={busy} data-testid="create-room">
          {busy ? 'Creating…' : 'Create room'}
        </Button>
      </div>
    </Screen>
  );
}

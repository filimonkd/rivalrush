import {
  CC_LIMITS,
  COLOR_CIPHER_ID,
  CRACK_THE_CODE_ID,
  CTC_LIMITS,
  DEFUSER_ID,
  type RoomSnapshot,
} from '@rivalrush/shared';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { HowToPlayButton } from '../components/HowToPlay';
import { Button, Card, Screen } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { gameInfo } from '../lib/games';
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
  const { gameId = CRACK_THE_CODE_ID } = useParams();
  const isCipher = gameId === COLOR_CIPHER_ID;
  // Reached from Home's Defuser card (live or staging preview); the server refuses it unless
  // Defuser is enabled there.
  const isDefuser = gameId === DEFUSER_ID;
  const game = gameInfo(isDefuser ? DEFUSER_ID : isCipher ? COLOR_CIPHER_ID : CRACK_THE_CODE_ID);
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
        body: isDefuser
          ? { gameType: DEFUSER_ID, settings: {} }
          : isCipher
            ? { gameType: COLOR_CIPHER_ID, settings: { turnSeconds, maxGuesses } }
            : { gameType: CRACK_THE_CODE_ID, settings: { codeLength, turnSeconds, maxGuesses } },
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
      <h1 className="text-3xl font-black">{isDefuser ? 'New team game' : 'New duel'}</h1>

      <Card className="flex items-center gap-3 border-2 border-accent">
        <div
          className={`grid h-12 w-12 place-items-center rounded-2xl text-xl font-black ${isDefuser ? 'bg-[#10142a] text-[#f5a524]' : isCipher ? 'bg-gradient-to-br from-[#0b7c86] to-[#6b3fd1] text-white' : 'bg-accent text-accent-text'}`}
        >
          {isDefuser ? '⏱' : isCipher ? '◆' : '#'}
        </div>
        <div className="min-w-0">
          <p className="font-black">{game.name}</p>
          <p className="text-sm text-muted">{game.blurb}</p>
          {!isDefuser && (
            <HowToPlayButton
              gameId={game.id}
              settings={
                isCipher ? { turnSeconds, maxGuesses } : { codeLength, turnSeconds, maxGuesses }
              }
              link
              className="mt-1"
            />
          )}
        </div>
      </Card>

      {isDefuser ? (
        <Card className="flex flex-col gap-2 text-sm text-muted" data-testid="defuser-create-info">
          <p className="font-bold text-text">
            One Operator sees the Charge; the Analysts hold the manual.
          </p>
          <p>
            2–4 players, about 5 minutes: a briefing of up to 20 s, then a 4:00–5:00 countdown.
            Three faults detonate it. Best on a Telegram voice call.
          </p>
          <HowToPlayButton gameId={DEFUSER_ID} className="self-start bg-surface" />
        </Card>
      ) : (
        <Card className="flex flex-col gap-5">
          {isCipher ? (
            <div>
              <div className="flex items-baseline justify-between">
                <p className="font-black">Pattern</p>
                <p className="text-xs text-muted">Same for every game</p>
              </div>
              <p className="mt-2 rounded-2xl bg-surface px-4 py-3 font-bold">
                {CC_LIMITS.patternLength} tiles · {CC_LIMITS.colorCount} colors · repeats allowed
              </p>
            </div>
          ) : (
            <Segmented
              testId="opt-length"
              label="Code length"
              hint="Fewer digits = faster games"
              options={[3, 4, 5] as const}
              value={codeLength as 3 | 4 | 5}
              onChange={setCodeLength}
            />
          )}
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
      )}

      <Card className="text-sm text-muted">
        {isDefuser ? (
          <p>
            The Operator describes what they see. The Analysts read their sheets and say what to do.
            Nobody can solve it alone.
          </p>
        ) : isCipher ? (
          <p>
            <span className="font-bold text-bull">◆ Exact</span> = right color, right spot.{' '}
            <span className="font-bold text-cow">◇ Close</span> = right color, wrong spot. Colors
            can repeat. If the first player cracks it, the second gets one last guess to tie.
          </p>
        ) : (
          <p>
            <span className="font-bold text-bull">● Bull</span> = right digit, right place.{' '}
            <span className="font-bold text-cow">○ Cow</span> = right digit, wrong place. Digits
            never repeat. If the first player cracks it, the second gets one last guess to tie.
          </p>
        )}
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

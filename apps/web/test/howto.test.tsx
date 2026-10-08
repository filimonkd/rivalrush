// @vitest-environment jsdom
import {
  COLOR_CIPHER_ID,
  CRACK_THE_CODE_ID,
  DEFUSER_ID,
  type RoomSnapshot,
} from '@rivalrush/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HowToPlay } from '../src/components/HowToPlay';
import { howToFor, seenHowTo } from '../src/lib/howto';
import { CreateRoomPage } from '../src/pages/CreateRoomPage';
import { LobbyView } from '../src/pages/LobbyView';
import { useSession } from '../src/store/session';
import { mount, reset, scene } from './defuser/harness';

const id = (t: string) => screen.getByTestId(t);
const maybe = (t: string) => screen.queryByTestId(t);
const click = (el: HTMLElement) => act(() => void fireEvent.click(el));

beforeEach(() => {
  localStorage.clear();
  useSession.setState({ status: 'ready', user: { id: 'u1', displayName: 'Ivy' } as never });
});
afterEach(() => {
  cleanup();
  reset();
});

const lobby = (gameType: string, settings: Record<string, unknown> = {}): RoomSnapshot =>
  ({
    roomId: 'room00000001',
    inviteToken: 'abcdefghabcdefgh',
    gameType,
    settings,
    status: 'LOBBY',
    hostId: 'u1',
    maxPlayers: gameType === 'defuser' ? 4 : 2,
    players: [
      {
        userId: 'u1',
        displayName: 'Ivy',
        photoUrl: null,
        isHost: true,
        ready: true,
        online: true,
        wantsRematch: false,
        graceDeadlineAt: null,
      },
    ],
    version: 1,
    createdAt: 0,
    expiresAt: 0,
    serverTime: 0,
    game: null,
    gamesPlayed: 0,
  }) as unknown as RoomSnapshot;

const showLobby = (gameType: string, settings: Record<string, unknown> = {}) =>
  render(
    <MemoryRouter>
      <LobbyView room={lobby(gameType, settings)} />
    </MemoryRouter>,
  );

const textOf = (gameId: string, settings?: Record<string, unknown>) =>
  howToFor(gameId)
    .steps(settings)
    .map((s) => [s.title, ...s.lines].join(' '))
    .join(' ');

describe('How to play', () => {
  it.each([DEFUSER_ID, CRACK_THE_CODE_ID, COLOR_CIPHER_ID])(
    '%s: walks through every step, back and forth, and ends with Got it',
    (gameId) => {
      const steps = howToFor(gameId).steps();
      let closed = 0;
      render(<HowToPlay gameId={gameId} onClose={() => closed++} />);
      expect(id('how-to-play').getAttribute('aria-label')).toMatch(/^How to play /);
      expect(id('howto-step').dataset.step).toBe('1');
      expect(maybe('howto-back')).toBeNull();
      for (let n = 2; n <= steps.length; n++) {
        click(id('howto-next'));
        expect(id('howto-step').dataset.step).toBe(String(n));
        expect(id('howto-step').textContent).toContain(steps[n - 1]!.title);
      }
      click(id('howto-back'));
      expect(id('howto-step').dataset.step).toBe(String(steps.length - 1));
      click(id('howto-next'));
      expect(maybe('howto-skip')).toBeNull();
      click(id('howto-done'));
      expect(closed).toBe(1);
      expect(seenHowTo(gameId)).toBe(true);
    },
  );

  it('can be skipped from the first step, which counts as seen for that game only', () => {
    let closed = 0;
    render(<HowToPlay gameId={CRACK_THE_CODE_ID} onClose={() => closed++} />);
    click(id('howto-skip'));
    expect(closed).toBe(1);
    expect(seenHowTo(CRACK_THE_CODE_ID)).toBe(true);
    expect(seenHowTo(COLOR_CIPHER_ID)).toBe(false);
    expect(seenHowTo(DEFUSER_ID)).toBe(false);
  });

  it('keeps the Defuser flag a device already has', () => {
    localStorage.setItem('rr.defuser.howToSeen', '1');
    expect(seenHowTo(DEFUSER_ID)).toBe(true);
  });
});

describe('what each explainer says', () => {
  it('Defuser covers what confused the first tester: reading the sheets and why it blew up', () => {
    const text = textOf(DEFUSER_ID);
    expect(text).toMatch(/first rule that is true/);
    expect(text).toMatch(/Heat table/);
    expect(text).toMatch(/frame value \+ mark value/);
    expect(text).toMatch(/level grid/);
    expect(text).toMatch(/3 faults: DETONATION/);
    expect(text).toMatch(/0:00 is also a DETONATION/);
  });

  it('Crack the Code: the code, bulls and cows with the documented example, turns and endings', () => {
    const text = textOf(CRACK_THE_CODE_ID);
    expect(text).toMatch(/4 digits from 0–9, no digit twice/);
    expect(text).toMatch(/Bull: a right digit in the right place/);
    expect(text).toMatch(/Cow: a right digit in the wrong place/);
    // docs/game-rules.md worked example, checked by the server's rules tests.
    expect(text).toMatch(/code is 5831 and you guess 5813.*2 bulls.*2 cows/);
    expect(text).toMatch(/45 seconds per turn/);
    expect(text).toMatch(/10 turns, timed-out ones included/);
    expect(text).toMatch(/one last guess. Crack it too and it’s a draw/);
    expect(text).toMatch(/more than 60 seconds: you lose/);
  });

  it('uses the room’s own numbers', () => {
    const text = textOf(CRACK_THE_CODE_ID, { codeLength: 3, turnSeconds: 90, maxGuesses: 8 });
    expect(text).toMatch(/3 digits from 0–9/);
    expect(text).toMatch(/90 seconds per turn/);
    expect(text).toMatch(/8 turns/);
    expect(textOf(COLOR_CIPHER_ID, { turnSeconds: 30, maxGuesses: 12 })).toMatch(
      /30 seconds per turn.*12 turns/,
    );
  });

  it('Color Cipher: repeats, symbols, Exact and Close with the documented duplicate case', () => {
    const text = textOf(COLOR_CIPHER_ID);
    expect(text).toMatch(/4 tiles. Each tile is one of 6 colors, and colors can repeat/);
    expect(text).toMatch(/own symbol/);
    expect(text).toMatch(/Exact: a right color in the right spot/);
    expect(text).toMatch(/Close: a right color in the wrong spot/);
    // docs/color-cipher.md scoring row 2 (R R L K vs R R R R → 2 Exact, 0 Close), a server test.
    expect(text).toMatch(/Ruby Ruby Sun Amber and you guess four Rubies: 2 Exact, 0 Close/);
    expect(text).toMatch(/cracks the pattern, the other gets one last guess/);
  });
});

describe('every lobby explains its game once per device', () => {
  it.each([DEFUSER_ID, CRACK_THE_CODE_ID, COLOR_CIPHER_ID])(
    '%s: opens by itself the first time, then only from the button',
    (gameId) => {
      showLobby(gameId);
      expect(id('how-to-play')).toBeTruthy();
      click(id('howto-skip'));
      expect(maybe('how-to-play')).toBeNull();
      cleanup();

      showLobby(gameId);
      expect(maybe('how-to-play')).toBeNull();
      click(id('open-how-to-play'));
      expect(id('how-to-play')).toBeTruthy();
    },
  );

  it('a team lobby gives it a card; a duel lobby a link beside the game name', () => {
    showLobby(DEFUSER_ID);
    click(id('howto-skip'));
    expect(screen.getByText('New to Defuser?')).toBeTruthy();
    cleanup();
    showLobby(CRACK_THE_CODE_ID);
    click(id('howto-skip'));
    expect(screen.queryByText(/^New to/)).toBeNull();
    expect(id('lobby-game').textContent).toBe('Crack the Code');
    expect(id('open-how-to-play').textContent).toBe('How to play');
  });

  it('seeing one game’s explainer does not hide another’s', () => {
    showLobby(CRACK_THE_CODE_ID);
    click(id('howto-skip'));
    cleanup();
    showLobby(COLOR_CIPHER_ID);
    expect(id('how-to-play')).toBeTruthy();
  });

  it('the lobby explainer shows the room’s settings', () => {
    showLobby(CRACK_THE_CODE_ID, { codeLength: 5, turnSeconds: 30, maxGuesses: 12 });
    expect(id('howto-step').textContent).toMatch(/5 digits/);
  });
});

describe('the create screen', () => {
  const create = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/create/:gameId" element={<CreateRoomPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it('offers How to play for a duel, with the chosen settings', () => {
    create(`/create/${CRACK_THE_CODE_ID}`);
    click(screen.getByTestId('opt-length').querySelectorAll('button')[0] as HTMLElement);
    click(id('open-how-to-play'));
    expect(id('how-to-play').getAttribute('aria-label')).toBe('How to play Crack the Code');
    expect(id('howto-step').textContent).toMatch(/3 digits/);
  });

  it('offers it for Color Cipher too', () => {
    create(`/create/${COLOR_CIPHER_ID}`);
    click(id('open-how-to-play'));
    expect(id('how-to-play').getAttribute('aria-label')).toBe('How to play Color Cipher');
  });
});

describe('after a game', () => {
  it('the Defuser result screen offers How to play, for a team that just blew up', () => {
    mount(scene('debrief-faults'));
    expect(id('result-title').textContent).toBe('DETONATION');
    click(id('open-how-to-play'));
    expect(id('how-to-play').getAttribute('aria-label')).toBe('How to play Defuser');
  });
});

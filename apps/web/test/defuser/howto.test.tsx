// @vitest-environment jsdom
import type { RoomSnapshot } from '@rivalrush/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HowToPlay } from '../../src/features/defuser/HowToPlay';
import { HOW_TO_STEPS, seenHowTo } from '../../src/features/defuser/howto';
import { LobbyView } from '../../src/pages/LobbyView';
import { useSession } from '../../src/store/session';
import { mount, reset, scene } from './harness';

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

const lobby = (gameType: string): RoomSnapshot =>
  ({
    roomId: 'room00000001',
    inviteToken: 'abcdefghabcdefgh',
    gameType,
    settings: {},
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

const showLobby = (gameType: string) =>
  render(
    <MemoryRouter>
      <LobbyView room={lobby(gameType)} />
    </MemoryRouter>,
  );

describe('How to play', () => {
  it('walks through every step, back and forth, and ends with Got it', () => {
    let closed = 0;
    render(<HowToPlay onClose={() => closed++} />);
    expect(id('howto-step').dataset.step).toBe('1');
    expect(maybe('howto-back')).toBeNull();
    for (let n = 2; n <= HOW_TO_STEPS.length; n++) {
      click(id('howto-next'));
      expect(id('howto-step').dataset.step).toBe(String(n));
    }
    click(id('howto-back'));
    expect(id('howto-step').dataset.step).toBe(String(HOW_TO_STEPS.length - 1));
    click(id('howto-next'));
    expect(maybe('howto-skip')).toBeNull();
    click(id('howto-done'));
    expect(closed).toBe(1);
    expect(seenHowTo()).toBe(true);
  });

  it('covers what confused the first tester: reading the sheets and why it blew up', () => {
    const text = HOW_TO_STEPS.map((s) => [s.title, ...s.lines].join(' ')).join(' ');
    expect(text).toMatch(/first rule that is true/);
    expect(text).toMatch(/Heat table/);
    expect(text).toMatch(/frame value \+ mark value/);
    expect(text).toMatch(/level grid/);
    expect(text).toMatch(/3 faults: DETONATION/);
    expect(text).toMatch(/0:00 is also a DETONATION/);
  });

  it('can be skipped from the first step, which also counts as seen', () => {
    let closed = 0;
    render(<HowToPlay onClose={() => closed++} />);
    click(id('howto-skip'));
    expect(closed).toBe(1);
    expect(seenHowTo()).toBe(true);
  });
});

describe('the team lobby explains Defuser once per device', () => {
  it('opens by itself the first time, then only from the button', () => {
    showLobby('defuser');
    expect(id('how-to-play')).toBeTruthy();
    click(id('howto-skip'));
    expect(maybe('how-to-play')).toBeNull();
    cleanup();

    showLobby('defuser');
    expect(maybe('how-to-play')).toBeNull();
    click(id('open-how-to-play'));
    expect(id('how-to-play')).toBeTruthy();
  });

  it('never appears in a duel lobby', () => {
    showLobby('crack-the-code');
    expect(maybe('how-to-play')).toBeNull();
    expect(maybe('open-how-to-play')).toBeNull();
  });
});

describe('after a game', () => {
  it('the result screen offers How to play, for a team that just blew up', () => {
    mount(scene('debrief-faults'));
    expect(id('result-title').textContent).toBe('DETONATION');
    click(id('open-how-to-play'));
    expect(id('how-to-play')).toBeTruthy();
  });
});

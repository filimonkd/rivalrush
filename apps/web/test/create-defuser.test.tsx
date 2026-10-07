// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { CreateRoomPage } from '../src/pages/CreateRoomPage';

afterEach(cleanup);

describe('the hidden Defuser create route', () => {
  it('shows the team-game card, with its test id on the element', () => {
    render(
      <MemoryRouter initialEntries={['/create/defuser']}>
        <Routes>
          <Route path="/create/:gameId" element={<CreateRoomPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading').textContent).toBe('New team game');
    expect(screen.getByTestId('defuser-create-info').textContent).toContain(
      'One Operator sees the Charge',
    );
    expect(screen.getByTestId('create-room')).toBeTruthy();
  });
});

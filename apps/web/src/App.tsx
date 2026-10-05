import { useEffect, useRef } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { ConnectionBanner } from './components/ConnectionBanner';
import { Toaster } from './components/Toaster';
import { api } from './lib/api';
import { CreateRoomPage } from './pages/CreateRoomPage';
import {
  DevLoginPage,
  ErrorScreen,
  LoadingScreen,
  OpenInTelegramPage,
} from './pages/StatusScreens';
import { HistoryPage } from './pages/HistoryPage';
import { HomePage } from './pages/HomePage';
import { JoinPage } from './pages/JoinPage';
import { ProfilePage } from './pages/ProfilePage';
import { RoomPage } from './pages/RoomPage';
import { useSession } from './store/session';
import type { ActiveRoomResponse } from '@rivalrush/shared';

export function App() {
  const status = useSession((s) => s.status);
  const error = useSession((s) => s.error);

  useEffect(() => {
    void useSession.getState().boot();
  }, []);

  if (status === 'booting') return <LoadingScreen />;
  if (status === 'needs-telegram') return <OpenInTelegramPage />;
  if (status === 'needs-dev-login') return <DevLoginPage />;
  if (status === 'error') {
    return (
      <ErrorScreen
        title="Couldn't sign you in"
        message={error ?? ''}
        onRetry={() => void useSession.getState().boot()}
      />
    );
  }
  return (
    <>
      <ConnectionBanner />
      <Toaster />
      <AfterBoot />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/create" element={<CreateRoomPage />} />
        <Route path="/join/:inviteToken" element={<JoinPage />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/profile/:userId" element={<ProfilePage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route
          path="*"
          element={<ErrorScreen title="Nothing here" message="This page doesn't exist." />}
        />
      </Routes>
    </>
  );
}

/**
 * Once signed in: an invite from the signed launch data wins; otherwise a fresh launch on
 * Home drops the player straight back into an active game.
 */
function AfterBoot() {
  const navigate = useNavigate();
  const location = useLocation();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const invite = useSession.getState().consumeInvite();
    if (invite) {
      navigate(`/join/${invite}`, { replace: true });
      return;
    }
    if (location.pathname !== '/') return;
    api<ActiveRoomResponse>('/me/active-room')
      .then((r) => {
        if (r.room && r.room.status === 'IN_GAME')
          navigate(`/room/${r.room.roomId}`, { replace: true });
      })
      .catch(() => undefined);
  }, [navigate, location.pathname]);
  return null;
}

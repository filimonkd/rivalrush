import type { AuthResponse, PublicUser } from '@rivalrush/shared';
import { create } from 'zustand';
import { api, ApiError, setAuthToken } from '../lib/api';
import { isInTelegram, rawInitData } from '../lib/telegram';

type Status = 'booting' | 'ready' | 'needs-telegram' | 'needs-dev-login' | 'error';

interface SessionState {
  status: Status;
  user: PublicUser | null;
  token: string | null;
  /** Invite from a validated start_param, consumed once after boot. */
  pendingInvite: string | null;
  error: string | null;
  boot(): Promise<void>;
  devLogin(name: string): Promise<void>;
  refreshMe(): Promise<void>;
  consumeInvite(): string | null;
}

const DEV_LOGIN = import.meta.env.VITE_DEV_LOGIN === 'true';
const DEV_KEY = 'rr.devName';

function readDevName(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get('dev');
  if (fromUrl) {
    try {
      sessionStorage.setItem(DEV_KEY, fromUrl);
    } catch {
      /* storage unavailable */
    }
    return fromUrl;
  }
  try {
    return sessionStorage.getItem(DEV_KEY);
  } catch {
    return null;
  }
}

export const useSession = create<SessionState>((set, get) => {
  const accept = (r: AuthResponse) => {
    setAuthToken(r.token);
    set({
      status: 'ready',
      user: r.user,
      token: r.token,
      pendingInvite: r.inviteToken,
      error: null,
    });
  };

  return {
    status: 'booting',
    user: null,
    token: null,
    pendingInvite: null,
    error: null,

    async boot() {
      set({ status: 'booting', error: null });
      try {
        if (isInTelegram()) {
          // The server validates this raw, signed string; nothing client-side is trusted.
          accept(
            await api<AuthResponse>('/auth/telegram', {
              method: 'POST',
              body: { initData: rawInitData() },
            }),
          );
          return;
        }
        if (DEV_LOGIN) {
          const name = readDevName();
          if (name) return await get().devLogin(name);
          set({ status: 'needs-dev-login' });
          return;
        }
        set({ status: 'needs-telegram' });
      } catch (err) {
        set({
          status: 'error',
          error: err instanceof ApiError ? err.message : 'Could not sign you in.',
        });
      }
    },

    async devLogin(name: string) {
      accept(await api<AuthResponse>('/auth/dev', { method: 'POST', body: { name } }));
      try {
        sessionStorage.setItem(DEV_KEY, name);
      } catch {
        /* ignore */
      }
    },

    async refreshMe() {
      const user = await api<PublicUser>('/me');
      set({ user });
    },

    consumeInvite() {
      const invite = get().pendingInvite;
      if (invite) set({ pendingInvite: null });
      return invite;
    },
  };
});

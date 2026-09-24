import { create } from 'zustand';
import type { User } from '@contenter/shared';

interface AuthState {
  /** Access token lives in memory only; the refresh token is an httpOnly cookie. */
  accessToken: string | null;
  user: User | null;
  status: 'idle' | 'ready';
  setSession: (token: string, user: User) => void;
  setUser: (user: User) => void;
  clear: () => void;
  markReady: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  status: 'idle',
  setSession: (accessToken, user) => set({ accessToken, user, status: 'ready' }),
  setUser: (user) => set({ user }),
  clear: () => set({ accessToken: null, user: null, status: 'ready' }),
  markReady: () => set({ status: 'ready' }),
}));

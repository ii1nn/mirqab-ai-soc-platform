import { isAxiosError } from 'axios';
import { create } from 'zustand';
import { authService, type AuthUser } from '../services/auth.service';

type AuthStatus = 'idle' | 'authenticating' | 'authenticated' | 'unauthenticated';
/** 'network_error' when the backend itself is unreachable (no HTTP response
 * at all) — distinct from a real 401, which means invalid credentials. See
 * apps/soc-dashboard's auth.store.ts, which already had this distinction;
 * this store previously collapsed both into the same generic message. */
type AuthErrorCode = 'invalid_credentials' | 'network_error';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  accessToken: string | null;
  error: AuthErrorCode | null;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<string | null>;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'idle',
  user: null,
  accessToken: null,
  error: null,

  async bootstrap() {
    set({ status: 'authenticating' });
    const storedRefreshToken = await window.mirqab.auth.getRefreshToken();

    if (!storedRefreshToken) {
      set({ status: 'unauthenticated' });
      return;
    }

    try {
      const tokens = await authService.refresh(storedRefreshToken);
      await window.mirqab.auth.saveRefreshToken(tokens.refreshToken);
      set({ accessToken: tokens.accessToken });
      const user = await authService.me();
      set({ status: 'authenticated', user, error: null });
    } catch {
      await window.mirqab.auth.clearRefreshToken();
      set({ status: 'unauthenticated', accessToken: null, user: null });
    }
  },

  async login(email, password) {
    set({ status: 'authenticating', error: null });
    try {
      const tokens = await authService.login(email, password);
      await window.mirqab.auth.saveRefreshToken(tokens.refreshToken);
      set({ accessToken: tokens.accessToken });
      const user = await authService.me();
      set({ status: 'authenticated', user });
    } catch (error) {
      const code: AuthErrorCode =
        isAxiosError(error) && !error.response ? 'network_error' : 'invalid_credentials';
      set({
        status: 'unauthenticated',
        accessToken: null,
        user: null,
        error: code,
      });
      throw error;
    }
  },

  async logout() {
    const storedRefreshToken = await window.mirqab.auth.getRefreshToken();
    await window.mirqab.auth.clearRefreshToken();
    set({ status: 'unauthenticated', accessToken: null, user: null });
    if (storedRefreshToken) {
      authService.logout(storedRefreshToken).catch(() => undefined);
    }
  },

  async refreshSession() {
    const storedRefreshToken = await window.mirqab.auth.getRefreshToken();
    if (!storedRefreshToken) return null;

    try {
      const tokens = await authService.refresh(storedRefreshToken);
      await window.mirqab.auth.saveRefreshToken(tokens.refreshToken);
      set({ accessToken: tokens.accessToken });
      return tokens.accessToken;
    } catch {
      return null;
    }
  },
}));

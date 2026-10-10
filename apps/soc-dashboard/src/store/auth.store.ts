import { isAxiosError } from 'axios';
import { create } from 'zustand';
import { authService, type AuthUser } from '../services/auth.service';

type AuthStatus = 'idle' | 'authenticating' | 'authenticated' | 'unauthenticated';

/**
 * This is a browser SPA, not the Electron employee app — there's no OS
 * keychain to lean on, so the refresh token is kept in localStorage rather
 * than an httpOnly cookie. That's a real tradeoff (an XSS bug could read
 * it); hardening this properly means moving refresh-token issuance to a
 * `Set-Cookie` (httpOnly, Secure, SameSite=strict) response from the
 * backend, which is out of scope for this phase. See docs/phases/phase-4.md.
 */
const REFRESH_TOKEN_STORAGE_KEY = 'mirqab.refreshToken';

/**
 * `error` on the store is a stable code, not a display string — LoginPage /
 * RegisterPage translate it via `t('auth.errors.<code>')` so the message
 * respects the active language instead of being baked in here.
 */
const FORBIDDEN_ROLE_MESSAGE = 'forbidden_role';

/**
 * Best-effort extraction of NestJS's ValidationPipe error shape
 * (`{ message: string | string[] }`) so a signup/login failure that isn't
 * one of our known codes still surfaces something actionable instead of a
 * silent generic message — helpful while wiring the backend up locally.
 */
function extractBackendMessage(error: unknown): string | null {
  if (!isAxiosError(error) || !error.response) return null;
  const data = error.response.data as { message?: string | string[] } | undefined;
  if (!data?.message) return null;
  return Array.isArray(data.message) ? data.message.join(', ') : data.message;
}

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  accessToken: string | null;
  error: string | null;
  /** Raw backend/network detail behind `error`, when available — see extractBackendMessage. */
  errorDetail: string | null;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  /** Resolves with the backend's pending-approval message — signup no longer auto-authenticates. */
  signup: (input: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    confirmPassword: string;
  }) => Promise<string>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<string | null>;
}

function rejectIfEmployee(user: AuthUser): void {
  if (user.role === 'EMPLOYEE') {
    throw new Error(FORBIDDEN_ROLE_MESSAGE);
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'idle',
  user: null,
  accessToken: null,
  error: null,
  errorDetail: null,

  async bootstrap() {
    set({ status: 'authenticating' });
    const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);

    if (!storedRefreshToken) {
      set({ status: 'unauthenticated' });
      return;
    }

    try {
      const tokens = await authService.refresh(storedRefreshToken);
      localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, tokens.refreshToken);
      set({ accessToken: tokens.accessToken });
      const user = await authService.me();
      rejectIfEmployee(user);
      set({ status: 'authenticated', user, error: null });
    } catch {
      localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
      set({ status: 'unauthenticated', accessToken: null, user: null });
    }
  },

  async login(email, password) {
    set({ status: 'authenticating', error: null, errorDetail: null });
    try {
      const tokens = await authService.login(email, password);
      localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, tokens.refreshToken);
      set({ accessToken: tokens.accessToken });

      const user = await authService.me();
      rejectIfEmployee(user);

      // Sign-in is now logged server-side (AuthService.login writes to AuditLog).
      set({ status: 'authenticated', user });
    } catch (error) {
      localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
      let code = 'invalid_credentials';
      if (error instanceof Error && error.message === FORBIDDEN_ROLE_MESSAGE) {
        code = FORBIDDEN_ROLE_MESSAGE;
      } else if (isAxiosError(error) && !error.response) {
        code = 'network_error';
      }
      set({
        status: 'unauthenticated',
        accessToken: null,
        user: null,
        error: code,
        errorDetail: extractBackendMessage(error),
      });
      throw error;
    }
  },

  async signup(input) {
    set({ status: 'authenticating', error: null, errorDetail: null });
    try {
      const { message } = await authService.signup(input);
      // Account is created inactive, pending admin approval — no session to store.
      set({ status: 'unauthenticated', accessToken: null, user: null });
      return message;
    } catch (error) {
      let code = 'signup_failed';
      if (isAxiosError(error) && !error.response) {
        code = 'network_error';
      } else if (isAxiosError(error) && error.response?.status === 409) {
        code = 'email_taken';
      }
      set({
        status: 'unauthenticated',
        accessToken: null,
        user: null,
        error: code,
        errorDetail: extractBackendMessage(error),
      });
      throw error;
    }
  },

  async logout() {
    const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    set({ status: 'unauthenticated', accessToken: null, user: null });
    // Sign-out is logged server-side (AuthService.logout writes to AuditLog).
    if (storedRefreshToken) {
      authService.logout(storedRefreshToken).catch(() => undefined);
    }
  },

  async refreshSession() {
    const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
    if (!storedRefreshToken) return null;

    try {
      const tokens = await authService.refresh(storedRefreshToken);
      localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, tokens.refreshToken);
      set({ accessToken: tokens.accessToken });
      return tokens.accessToken;
    } catch {
      return null;
    }
  },
}));

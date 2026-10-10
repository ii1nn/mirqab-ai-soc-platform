import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/auth.store';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1',
});

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const { accessToken } = useAuthStore.getState();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

let refreshPromise: Promise<string | null> | null = null;

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableConfig | undefined;

    // Phase 13: a 401 from an /auth/* call itself (e.g. a stale/invalid
    // refresh token rejected by /auth/refresh) must propagate as-is — see
    // apps/soc-dashboard/src/services/api-client.ts's identical fix and
    // its comment for the exact failure mode this prevents. Without it,
    // /auth/refresh's own 401 re-enters this interceptor and awaits the
    // still-pending `refreshPromise` that is itself waiting on that very
    // request to finish — a self-referential hang, not a caught error, so
    // bootstrap()/login() would never resolve rather than falling back to
    // the login screen.
    const isAuthEndpoint = originalRequest?.url?.startsWith('/auth/');

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      isAuthEndpoint
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;
    refreshPromise ??= useAuthStore.getState().refreshSession();
    const newAccessToken = await refreshPromise;
    refreshPromise = null;

    if (!newAccessToken) {
      useAuthStore.getState().logout();
      return Promise.reject(error);
    }

    originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
    return apiClient(originalRequest);
  },
);

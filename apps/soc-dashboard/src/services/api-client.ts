import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/auth.store';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1',
  // Axios defaults to no timeout at all. Without one, a request in flight
  // when the backend restarts (or any connection that stalls rather than
  // cleanly erroring) can hang indefinitely — and since useMutation's
  // isPending reflects "not yet settled", a hung isolate request would
  // permanently disable the confirm button with no visible error, looking
  // exactly like a click that silently does nothing. A bounded timeout
  // guarantees every request eventually settles one way or the other.
  //
  // MUST stay comfortably above backend's own longest legitimate wait —
  // WazuhActiveResponseProvider's EXECUTION_CONFIRMATION_TIMEOUT_MS (20s,
  // see backend/src/modules/devices/endpoint-control/wazuh-active-response.provider.ts).
  // A client timeout shorter than that isn't theoretical: it was confirmed
  // live to abort the connection (nginx logs HTTP 499) seconds before the
  // backend reached its own honest answer, hiding a real FAILED/SUCCESS
  // result behind a generic "couldn't submit" error. 30s = 20s + a 10s
  // safety margin for normal network/proxy latency on top of that wait.
  // These two values have no shared-types package to enforce this
  // automatically (see packages/shared-types) — keep them in sync by hand.
  timeout: 30_000,
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
    // A 401 from an /auth/* call itself (e.g. a stale refresh token rejected
    // by /auth/refresh) must propagate as-is. Treating it as "access token
    // expired, refresh and retry" would call authService.refresh() again
    // with that same stale token, land back in this interceptor, and await
    // the still-pending outer refreshPromise from inside itself — a
    // self-referential wait that never resolves, hanging bootstrap()/login()
    // forever instead of falling back to the login page.
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

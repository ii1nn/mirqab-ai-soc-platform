import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '../store/auth.store';

// The gateway lives on the bare API origin, not under the /api/v1 REST
// prefix — socket.io namespaces are a separate concept from HTTP routes.
function socketOrigin(): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';
  return base.replace(/\/api\/v1\/?$/, '');
}

export const REALTIME_EVENTS = {
  INCIDENT_CREATED: 'incident.created',
  INCIDENT_UPDATED: 'incident.updated',
  INCIDENT_ACTION_CREATED: 'incident-action.created',
  INCIDENT_ACTION_UPDATED: 'incident-action.updated',
  TICKET_CREATED: 'ticket.created',
  TICKET_UPDATED: 'ticket.updated',
  POLICY_UPDATED: 'policy.updated',
  AUDIT_LOG_CREATED: 'audit-log.created',
  NOTIFICATION_CREATED: 'notification.created',
} as const;

let socket: Socket | null = null;

/**
 * Lazily creates a single shared socket. `auth` is a function (not a fixed
 * object) so a reconnect always sends the current access token — important
 * since tokens rotate via the axios refresh interceptor independently of
 * this connection's lifecycle.
 */
export function getSocket(): Socket {
  socket ??= io(`${socketOrigin()}/realtime`, {
    autoConnect: false,
    auth: (callback) => callback({ token: useAuthStore.getState().accessToken }),
    // Bounded, backed-off reconnection — the default (unbounded attempts)
    // let a handshake that keeps getting rejected (e.g. the gateway's own
    // rate limiter) retry in a storm rather than backing off. Once
    // reconnectionAttempts is exhausted the socket gives up and
    // useRealtimeSync's existing 30s React Query polling remains the
    // safety net (see that hook's doc comment) — realtime isn't disabled,
    // it just stops hammering a connection that isn't succeeding.
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2_000,
    reconnectionDelayMax: 30_000,
    randomizationFactor: 0.5,
  });
  return socket;
}

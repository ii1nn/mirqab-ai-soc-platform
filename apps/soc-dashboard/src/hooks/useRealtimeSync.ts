import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getSocket, REALTIME_EVENTS } from '../lib/socket';
import { useAuthStore } from '../store/auth.store';

/**
 * Real-time push, layered over the existing React Query polling. Socket
 * events only ever trigger `invalidateQueries` — they never write server
 * data into the cache directly — so the REST adapters stay the single
 * source of truth for shaping backend responses. Polling remains active at
 * a longer interval as a safety net for any gap in socket delivery (a
 * missed reconnect window, a dropped event).
 */
export function useRealtimeSync(): void {
  const queryClient = useQueryClient();
  const status = useAuthStore((state) => state.status);

  useEffect(() => {
    if (status !== 'authenticated') return;

    const socket = getSocket();
    socket.connect();

    const invalidate =
      (...keys: string[]) =>
      () => {
        for (const key of keys) queryClient.invalidateQueries({ queryKey: [key] });
      };

    // Device status/currentScore is derived server-side from open incidents
    // (see DevicesService.withComputedStatus), so an incident event also
    // invalidates the devices cache even though there's no device-specific
    // socket event.
    const onIncidentEvent = invalidate('incidents', 'devices');
    const onTicketEvent = invalidate('tickets');
    const onPolicyEvent = invalidate('policies');
    const onAuditLogEvent = invalidate('audit-logs');
    // A response-window notification (response required / containment
    // result) — the list is refetched through the REST adapter, and the
    // incident's own response state is refreshed with it.
    const onNotificationEvent = (payload: { notification: { incident: { id: string } } }) => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({
        queryKey: ['incidents', payload.notification.incident.id, 'history'],
      });
    };
    // Investigation/action data is keyed by incident id, so a targeted
    // invalidate (not a blanket 'incidents' one) keeps every open
    // investigation panel in sync with actions logged from anywhere.
    const onIncidentActionEvent = (payload: { action: { incidentId: string } }) => {
      queryClient.invalidateQueries({
        queryKey: ['incidents', payload.action.incidentId, 'investigation'],
      });
      queryClient.invalidateQueries({
        queryKey: ['incidents', payload.action.incidentId, 'actions'],
      });
      // An isolate-device action's outcome (PENDING/SUCCESS/FAILED) drives
      // IncidentHistoryRecord.isolated (IncidentInvestigationPanel) and
      // Device.isolated (ThreatTopology) — both need to refresh so a second
      // connected analyst sees a confirmed isolation without waiting on an
      // unrelated refetch.
      queryClient.invalidateQueries({
        queryKey: ['incidents', payload.action.incidentId, 'history'],
      });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    };

    socket.on(REALTIME_EVENTS.INCIDENT_CREATED, onIncidentEvent);
    socket.on(REALTIME_EVENTS.INCIDENT_UPDATED, onIncidentEvent);
    socket.on(REALTIME_EVENTS.INCIDENT_ACTION_CREATED, onIncidentActionEvent);
    socket.on(REALTIME_EVENTS.INCIDENT_ACTION_UPDATED, onIncidentActionEvent);
    socket.on(REALTIME_EVENTS.TICKET_CREATED, onTicketEvent);
    socket.on(REALTIME_EVENTS.TICKET_UPDATED, onTicketEvent);
    socket.on(REALTIME_EVENTS.POLICY_UPDATED, onPolicyEvent);
    socket.on(REALTIME_EVENTS.AUDIT_LOG_CREATED, onAuditLogEvent);
    socket.on(REALTIME_EVENTS.NOTIFICATION_CREATED, onNotificationEvent);

    // Phase 13: compatibility with Phase 12's server-side expiry-bound
    // disconnect (RealtimeGateway force-disconnects a socket the moment its
    // access token's own 15-minute exp elapses). Socket.IO's client never
    // auto-reconnects after a disconnect the *server* initiated (reason
    // 'io server disconnect') — by design, since that could otherwise mask
    // a deliberate server-side kick. Without this, once a socket hit its
    // own token's natural 15-minute expiry, this app's realtime sync would
    // go silently, permanently dark for the rest of the browser session (React
    // Query polling remains a safety net, per the comment above, but the
    // whole point of this hook is not to depend on that alone). `auth` is
    // already a function re-read on every connect (see lib/socket.ts) — by
    // the time this fires, the access token has normally already been
    // rotated by the axios refresh interceptor's independent 401 handling,
    // so this reconnect attempt uses a fresh token, not the expired one.
    const onDisconnect = (reason: string) => {
      if (reason === 'io server disconnect') {
        socket.connect();
      }
    };
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off(REALTIME_EVENTS.INCIDENT_CREATED, onIncidentEvent);
      socket.off(REALTIME_EVENTS.INCIDENT_UPDATED, onIncidentEvent);
      socket.off(REALTIME_EVENTS.INCIDENT_ACTION_CREATED, onIncidentActionEvent);
      socket.off(REALTIME_EVENTS.INCIDENT_ACTION_UPDATED, onIncidentActionEvent);
      socket.off(REALTIME_EVENTS.TICKET_CREATED, onTicketEvent);
      socket.off(REALTIME_EVENTS.TICKET_UPDATED, onTicketEvent);
      socket.off(REALTIME_EVENTS.POLICY_UPDATED, onPolicyEvent);
      socket.off(REALTIME_EVENTS.AUDIT_LOG_CREATED, onAuditLogEvent);
      socket.off(REALTIME_EVENTS.NOTIFICATION_CREATED, onNotificationEvent);
      socket.off('disconnect', onDisconnect);
      socket.disconnect();
    };
  }, [status, queryClient]);
}

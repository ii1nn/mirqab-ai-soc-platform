import {
  AuditLog,
  Incident,
  IncidentAction,
  IncidentEvidence,
  Policy,
  Ticket,
} from '@prisma/client';

export const REALTIME_EVENTS = {
  INCIDENT_CREATED: 'incident.created',
  INCIDENT_UPDATED: 'incident.updated',
  /** A correlated event was attached to an already-open case — distinct from
   * INCIDENT_CREATED (no new case) and INCIDENT_UPDATED (no analyst edit). */
  INCIDENT_EVIDENCE_ADDED: 'incident.evidence-added',
  /** Persistence Detection found one or more real findings on this case. */
  PERSISTENCE_FINDING_DETECTED: 'incident.persistence-detected',
  INCIDENT_ACTION_CREATED: 'incident-action.created',
  INCIDENT_ACTION_UPDATED: 'incident-action.updated',
  TICKET_CREATED: 'ticket.created',
  TICKET_UPDATED: 'ticket.updated',
  POLICY_UPDATED: 'policy.updated',
  AUDIT_LOG_CREATED: 'audit-log.created',
  /** A response-window notification (see NotificationsService) — routed to
   * the incident's organization/department rooms like every incident event. */
  NOTIFICATION_CREATED: 'notification.created',
} as const;

export interface IncidentEventPayload {
  incident: Incident;
}

export interface IncidentEvidenceEventPayload {
  incident: Incident;
  evidence: IncidentEvidence;
}

export interface PersistenceFindingEventPayload {
  incidentId: string;
  count: number;
  /** The parent incident's department — IncidentAction has no departmentId
   * of its own (see schema.prisma), so this is populated at the emit call
   * site (AiService.runDetection) rather than derived from the payload
   * shape alone. Used by RealtimeGateway to route this to the correct
   * department room(s) instead of broadcasting it to every connection. */
  departmentId: string | null;
  /** Phase 2.6B — same rationale as departmentId above, for the
   * organization dimension. Used by RealtimeGateway to route this to the
   * correct organization room. */
  organizationId: string | null;
}

export interface IncidentActionEventPayload {
  action: IncidentAction;
  /** Same rationale as PersistenceFindingEventPayload.departmentId. */
  departmentId: string | null;
  /** Phase 2.6B — same rationale as PersistenceFindingEventPayload.organizationId. */
  organizationId: string | null;
}

export interface TicketEventPayload {
  ticket: Ticket;
}

export interface PolicyEventPayload {
  policy: Policy;
}

export interface AuditLogEventPayload {
  auditLog: AuditLog;
}

export interface NotificationEventPayload {
  /** NotificationsService's serialized, locale-neutral view. */
  notification: unknown;
  serverNow: Date;
  /** The parent incident's scope — same rationale as
   * PersistenceFindingEventPayload.departmentId/organizationId. */
  organizationId: string | null;
  departmentId: string | null;
}

import type {
  ActionApprovalStatus,
  AiAgentName,
  BusinessImpact,
  ContainmentBlockReason,
  ContainmentNotificationResult,
  DeviceStatus,
  IncidentActionOutcome,
  IncidentActionType,
  IncidentStatus,
  IndicatorCategory,
  IndicatorType,
  NotificationKind,
  PersistenceType,
  ResponseWindow,
  ResponseWindowState,
  Severity,
  SocNotification,
  TicketStatus,
} from '../types/domain';
import type {
  BackendActionApprovalStatus,
  BackendAiAgentName,
  BackendBusinessImpact,
  BackendDeviceStatus,
  BackendIncidentActionOutcome,
  BackendIncidentActionType,
  BackendIncidentStatus,
  BackendIndicatorCategory,
  BackendIndicatorType,
  BackendNotification,
  BackendPersistenceType,
  BackendResponseWindow,
  BackendSeverity,
  BackendTicketStatus,
} from './backend-types';

export function fromBackendSeverity(severity: BackendSeverity): Severity {
  return severity.toLowerCase() as Severity;
}

export function toBackendSeverity(severity: Severity): BackendSeverity {
  return severity.toUpperCase() as BackendSeverity;
}

export function fromBackendIncidentStatus(status: BackendIncidentStatus): IncidentStatus {
  return status.toLowerCase() as IncidentStatus;
}

export function toBackendIncidentStatus(status: IncidentStatus): BackendIncidentStatus {
  return status.toUpperCase() as BackendIncidentStatus;
}

export function fromBackendTicketStatus(status: BackendTicketStatus): TicketStatus {
  return status.toLowerCase().replace('_', '-') as TicketStatus;
}

export function toBackendTicketStatus(status: TicketStatus): BackendTicketStatus {
  return status.toUpperCase().replace('-', '_') as BackendTicketStatus;
}

export function fromBackendDeviceStatus(status: BackendDeviceStatus): DeviceStatus {
  return status.toLowerCase().replace('_', '-') as DeviceStatus;
}

/** 'WAITING_RESPONSE' → 'waiting-response', same convention as the other enums here. */
function toKebab<T extends string>(code: string): T {
  return code.toLowerCase().replace(/_/g, '-') as T;
}

export function fromBackendResponseWindow(window: BackendResponseWindow): ResponseWindow {
  return {
    ...window,
    receivedAt: Date.now(),
    state: toKebab<ResponseWindowState>(window.state),
    containment: window.containment
      ? { ...window.containment, outcome: fromBackendActionOutcome(window.containment.outcome) }
      : null,
    automatedContainment: {
      ...window.automatedContainment,
      blockedReason: window.automatedContainment.blockedReason
        ? toKebab<ContainmentBlockReason>(window.automatedContainment.blockedReason)
        : null,
    },
  };
}

export function fromBackendNotification(
  notification: BackendNotification,
  serverNow: string,
): SocNotification {
  return {
    id: notification.id,
    kind: toKebab<NotificationKind>(notification.kind),
    containmentResult: notification.containmentResult
      ? toKebab<ContainmentNotificationResult>(notification.containmentResult)
      : null,
    createdAt: notification.createdAt,
    serverNow,
    receivedAt: Date.now(),
    fallbackTitle: notification.fallbackTitle,
    fallbackBody: notification.fallbackBody,
    incident: { ...notification.incident, severity: fromBackendSeverity(notification.incident.severity) },
  };
}

export function fromBackendRiskLevel(level: 'HIGH' | 'LOW'): 'high' | 'low' {
  return level.toLowerCase() as 'high' | 'low';
}

export function fromBackendActionType(type: BackendIncidentActionType): IncidentActionType {
  return type.toLowerCase().replace(/_/g, '-') as IncidentActionType;
}

export function toBackendActionType(type: IncidentActionType): BackendIncidentActionType {
  return type.toUpperCase().replace(/-/g, '_') as BackendIncidentActionType;
}

export function fromBackendActionOutcome(
  outcome: BackendIncidentActionOutcome,
): IncidentActionOutcome {
  return outcome.toLowerCase() as IncidentActionOutcome;
}

export function toBackendActionOutcome(
  outcome: IncidentActionOutcome,
): BackendIncidentActionOutcome {
  return outcome.toUpperCase() as BackendIncidentActionOutcome;
}

export function fromBackendApprovalStatus(
  status: BackendActionApprovalStatus,
): ActionApprovalStatus {
  return status.toLowerCase().replace(/_/g, '-') as ActionApprovalStatus;
}

export function fromBackendBusinessImpact(impact: BackendBusinessImpact): BusinessImpact {
  return impact.toLowerCase() as BusinessImpact;
}

export function fromBackendIndicatorCategory(
  category: BackendIndicatorCategory,
): IndicatorCategory {
  return category.toLowerCase() as IndicatorCategory;
}

export function fromBackendIndicatorType(type: BackendIndicatorType): IndicatorType {
  return type.toLowerCase().replace(/_/g, '-') as IndicatorType;
}

export function fromBackendPersistenceType(type: BackendPersistenceType): PersistenceType {
  return type.toLowerCase().replace(/_/g, '-') as PersistenceType;
}

export function fromBackendAiAgentName(agent: BackendAiAgentName): AiAgentName {
  return agent.toLowerCase().replace(/_/g, '-') as AiAgentName;
}

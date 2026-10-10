import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Notification, NotificationAudience, Prisma, Severity } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import {
  departmentScopeWhere,
  organizationScopeWhere,
} from '../../common/guards/department-access.util';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import {
  ContainmentNotificationResult,
  NOTIFICATION_KIND_PREFIX,
  NOTIFICATION_KINDS,
  RESPONSE_WINDOW_MS,
} from '../ai/response-sla/response-sla.constants';
import { REALTIME_EVENTS } from '../websocket/events';

export type NotificationKind = 'RESPONSE_REQUIRED' | 'CONTAINMENT_RESULT' | 'LEGACY';

/** Structured, locale-neutral notification — the frontend renders the
 * English/Arabic text from these fields; `fallbackTitle`/`fallbackBody` are
 * the stored English text, only used for LEGACY rows written before this
 * workflow existed. */
export interface NotificationView {
  id: string;
  kind: NotificationKind;
  containmentResult: ContainmentNotificationResult | null;
  audience: NotificationAudience;
  createdAt: Date;
  fallbackTitle: string;
  fallbackBody: string;
  incident: {
    id: string;
    caseId: string;
    title: string;
    severity: Severity;
    deviceName: string | null;
    departmentName: string | null;
    detectedAt: Date;
    responseDeadline: Date;
    acknowledgedAt: Date | null;
  };
}

const INCIDENT_SELECT = {
  id: true,
  caseId: true,
  title: true,
  severity: true,
  createdAt: true,
  acknowledgedAt: true,
  departmentId: true,
  organizationId: true,
  device: { select: { hostname: true } },
  department: { select: { name: true } },
} satisfies Prisma.IncidentSelect;

type NotificationIncident = Prisma.IncidentGetPayload<{ select: typeof INCIDENT_SELECT }>;

const CONTAINMENT_RESULTS: ReadonlySet<string> = new Set<ContainmentNotificationResult>([
  'SUCCEEDED',
  'FAILED',
  'UNAVAILABLE',
  'POLICY_DISABLED',
]);

function parseKind(title: string): { kind: NotificationKind; containmentResult: ContainmentNotificationResult | null } {
  if (title === NOTIFICATION_KINDS.RESPONSE_REQUIRED) {
    return { kind: 'RESPONSE_REQUIRED', containmentResult: null };
  }
  if (title.startsWith(`${NOTIFICATION_KINDS.CONTAINMENT_RESULT}:`)) {
    const result = title.slice(NOTIFICATION_KINDS.CONTAINMENT_RESULT.length + 1);
    if (CONTAINMENT_RESULTS.has(result)) {
      return { kind: 'CONTAINMENT_RESULT', containmentResult: result as ContainmentNotificationResult };
    }
  }
  return { kind: 'LEGACY', containmentResult: null };
}

/**
 * Notifications for the SOC roles (ADMIN / SECURITY_ANALYST / IT_TECHNICIAN)
 * responsible for an incident under the existing RBAC model. There is no
 * per-user recipient column (no employee ownership model exists), so
 * "who receives it" is exactly "who can already see the incident": the
 * incident's organization, narrowed to its department for IT_TECHNICIAN —
 * the same rule IncidentAccessGuard and the realtime gateway's room routing
 * already enforce.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async notifyResponseRequired(incidentId: string): Promise<Notification | null> {
    return this.create(incidentId, NOTIFICATION_KINDS.RESPONSE_REQUIRED, (incident) =>
      `Security incident ${incident.caseId} detected on ${incident.device?.hostname ?? 'an unresolved device'}. ` +
      `Please review and respond within ${RESPONSE_WINDOW_MS / 60_000} minutes (by ${new Date(
        incident.createdAt.getTime() + RESPONSE_WINDOW_MS,
      ).toISOString()}).`,
    );
  }

  async notifyContainmentResult(
    incidentId: string,
    result: ContainmentNotificationResult,
    detail?: string | null,
  ): Promise<Notification | null> {
    const sentence: Record<ContainmentNotificationResult, string> = {
      SUCCEEDED: 'Automatic containment succeeded: the endpoint isolation was confirmed by the endpoint-control provider.',
      FAILED: 'Automatic containment was attempted but did not succeed.',
      UNAVAILABLE: 'Automatic containment is unavailable: no endpoint-control provider is configured.',
      POLICY_DISABLED: 'Automatic containment was not attempted: the "5-Minute Response Window" policy is disabled.',
    };
    return this.create(
      incidentId,
      `${NOTIFICATION_KINDS.CONTAINMENT_RESULT}:${result}`,
      (incident) =>
        `No response was received within ${RESPONSE_WINDOW_MS / 60_000} minutes for ${incident.caseId} ` +
        `(${incident.device?.hostname ?? 'unresolved device'}). ${sentence[result]}${detail ? ` Reason: ${detail}` : ''}`,
    );
  }

  /** Scoped exactly like the incidents themselves — never another
   * organization's or (for IT_TECHNICIAN) another department's rows. */
  async listForUser(user: AuthenticatedUser, limit = 100): Promise<{ serverNow: Date; items: NotificationView[] }> {
    const deptScope = departmentScopeWhere(user);
    const rows = await this.prisma.notification.findMany({
      where: {
        audience: NotificationAudience.ANALYST,
        incident: {
          ...organizationScopeWhere(user),
          ...(deptScope ? { OR: deptScope.OR } : {}),
        },
      },
      include: { incident: { select: INCIDENT_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return { serverNow: new Date(), items: rows.map((row) => this.toView(row, row.incident)) };
  }

  private async create(
    incidentId: string,
    title: string,
    body: (incident: NotificationIncident) => string,
  ): Promise<Notification | null> {
    // A notification is a courtesy on top of an already-committed security
    // record (the incident, the action, the audit row) — a failure here is
    // logged, never allowed to fail or roll back that record.
    try {
      const incident = await this.prisma.incident.findUnique({
        where: { id: incidentId },
        select: INCIDENT_SELECT,
      });
      if (!incident) return null;

      const notification = await this.prisma.notification.create({
        data: { incidentId, audience: NotificationAudience.ANALYST, title, body: body(incident) },
      });
      this.events.emit(REALTIME_EVENTS.NOTIFICATION_CREATED, {
        notification: this.toView(notification, incident),
        serverNow: new Date(),
        organizationId: incident.organizationId,
        departmentId: incident.departmentId,
      });
      return notification;
    } catch (error) {
      this.logger.warn(
        `Failed to create ${title.startsWith(NOTIFICATION_KIND_PREFIX) ? title : 'a'} notification for incident ${incidentId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
      return null;
    }
  }

  private toView(notification: Notification, incident: NotificationIncident): NotificationView {
    const { kind, containmentResult } = parseKind(notification.title);
    return {
      id: notification.id,
      kind,
      containmentResult,
      audience: notification.audience,
      createdAt: notification.createdAt,
      fallbackTitle: notification.title,
      fallbackBody: notification.body,
      incident: {
        id: incident.id,
        caseId: incident.caseId,
        title: incident.title,
        severity: incident.severity,
        deviceName: incident.device?.hostname ?? null,
        departmentName: incident.department?.name ?? null,
        detectedAt: incident.createdAt,
        responseDeadline: new Date(incident.createdAt.getTime() + RESPONSE_WINDOW_MS),
        acknowledgedAt: incident.acknowledgedAt,
      },
    };
  }
}

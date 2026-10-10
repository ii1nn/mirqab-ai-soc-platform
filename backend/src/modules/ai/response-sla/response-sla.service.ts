import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ActionApprovalStatus,
  AuditLog,
  Incident,
  IncidentAction,
  IncidentActionOutcome,
  IncidentActionType,
  IncidentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface';
import { EndpointControlService } from '../../devices/endpoint-control/endpoint-control.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { REALTIME_EVENTS } from '../../websocket/events';
import { AiService } from '../ai.service';
import {
  AUTOMATED_CONTAINMENT_ACTOR,
  ContainmentNotificationResult,
  RESPONSE_AUDIT,
  RESPONSE_SWEEP_BATCH,
  RESPONSE_WINDOW_MS,
  RESPONSE_WINDOW_POLICY_NAME,
  RESPONSE_WINDOW_SEVERITIES,
} from './response-sla.constants';
import {
  buildResponseView,
  ContainmentBlockReason,
  evaluateContainmentEligibility,
  isSimulatedIncident,
  loadResponseAuditFacts,
  readSimulatedFlags,
  responseDeadline,
  ResponseView,
} from './response-sla.util';

type ExpiryDecision =
  | { kind: 'CONTAIN'; incident: Incident; action: IncidentAction; audits: AuditLog[] }
  | { kind: 'BLOCKED'; incident: Incident; reason: ContainmentBlockReason; audits: AuditLog[] };

const BLOCKED_AUDIT: Partial<Record<ContainmentBlockReason, string>> = {
  SIMULATED: RESPONSE_AUDIT.CONTAINMENT_SIMULATED,
  POLICY_DISABLED: RESPONSE_AUDIT.CONTAINMENT_POLICY_DISABLED,
  PROVIDER_UNAVAILABLE: RESPONSE_AUDIT.CONTAINMENT_UNAVAILABLE,
};

const BLOCKED_NOTIFICATION: Partial<Record<ContainmentBlockReason, ContainmentNotificationResult>> = {
  POLICY_DISABLED: 'POLICY_DISABLED',
  PROVIDER_UNAVAILABLE: 'UNAVAILABLE',
};

/**
 * The single authoritative 5-minute response window and automated
 * containment flow. Nothing else in the backend or frontend decides when an
 * incident's response window has expired or whether its endpoint may be
 * isolated automatically.
 *
 *   T0 = Incident.createdAt → deadline = T0 + 5 min
 *   acknowledged before the deadline → no automated containment, ever
 *   deadline passes unacknowledged → ONE once-only decision, taken inside a
 *     per-incident Postgres advisory transaction lock:
 *       - simulated / policy disabled / no endpoint-control provider →
 *         recorded as not attempted (no IncidentAction is created)
 *       - otherwise → a PENDING ISOLATE_DEVICE IncidentAction is committed
 *         FIRST, then the real provider (EndpointControlService → Wazuh
 *         Active Response with agent-callback verification) is called and the
 *         same row moves to SUCCESS/FAILED with the real result.
 *
 * Deterministic and rule-based — no AI/LLM is consulted for this decision.
 */
@Injectable()
export class ResponseSlaService {
  private readonly logger = new Logger(ResponseSlaService.name);
  /** Per-process overlap guard only (a provider call can outlast the 30s
   * tick). Correctness across ticks/replicas comes from the advisory lock
   * and the once-only decision marker, never from this flag. */
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly endpointControl: EndpointControlService,
    private readonly aiService: AiService,
    private readonly notifications: NotificationsService,
  ) {}

  async sweep(now: Date = new Date()): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const candidates = await this.prisma.incident.findMany({
        where: {
          status: IncidentStatus.OPEN,
          acknowledgedAt: null,
          severity: { in: Array.from(RESPONSE_WINDOW_SEVERITIES) },
          deviceId: { not: null },
          organizationId: { not: null },
          createdAt: { lte: new Date(now.getTime() - RESPONSE_WINDOW_MS) },
          actions: { none: { type: IncidentActionType.ISOLATE_DEVICE } },
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: RESPONSE_SWEEP_BATCH,
      });
      if (candidates.length === 0) return;

      // Fast path only — the authoritative once-only check is repeated
      // inside the lock (see decideExpired).
      const decided = await this.prisma.auditLog.findMany({
        where: { target: { in: candidates.map((c) => c.id) }, action: RESPONSE_AUDIT.WINDOW_EXPIRED },
        select: { target: true },
      });
      const decidedIds = new Set(decided.map((row) => row.target));

      for (const { id } of candidates) {
        if (decidedIds.has(id)) continue;
        try {
          await this.processExpired(id, now);
        } catch (error) {
          this.logger.error(
            `Response-window decision failed for incident ${id} — no containment was attempted: ${
              error instanceof Error ? error.message : error
            }`,
          );
        }
      }
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Explicit "Acknowledge & Investigate". Idempotent: a second call returns
   * the existing acknowledgement without a new audit row. Shares the
   * containment decision's advisory lock, so it either lands first (and
   * containment never happens) or after (and is recorded as a late
   * response — never undoing an isolation that already happened).
   */
  async acknowledge(incidentId: string, user: AuthenticatedUser): Promise<{
    alreadyAcknowledged: boolean;
    response: ResponseView;
  }> {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockIncident(tx, incidentId);
      // Taken only once the lock is held: if a containment decision won the
      // lock first, this acknowledgement is correctly timestamped after it.
      const now = new Date();
      const incident = await tx.incident.findUnique({ where: { id: incidentId } });
      if (!incident) {
        throw new NotFoundException('Incident not found');
      }
      if (incident.acknowledgedAt) {
        return { alreadyAcknowledged: true, incident, audit: null };
      }

      const withinWindow = now.getTime() <= responseDeadline(incident.createdAt).getTime();
      const updated = await tx.incident.update({
        where: { id: incidentId },
        data: {
          acknowledgedAt: now,
          // Same transition the pre-existing Acknowledge button made — only
          // from OPEN; a CONTAINED/RESOLVED case keeps its status.
          status: incident.status === IncidentStatus.OPEN ? IncidentStatus.INVESTIGATING : undefined,
        },
      });
      const audit = await tx.auditLog.create({
        data: {
          actorEmail: user.email,
          action: withinWindow
            ? RESPONSE_AUDIT.ACKNOWLEDGED_WITHIN_WINDOW
            : RESPONSE_AUDIT.ACKNOWLEDGED_AFTER_WINDOW,
          target: incidentId,
          organizationId: incident.organizationId,
        },
      });
      return { alreadyAcknowledged: false, incident: updated, audit };
    });

    if (result.audit) {
      this.events.emit(REALTIME_EVENTS.AUDIT_LOG_CREATED, { auditLog: result.audit });
      this.events.emit(REALTIME_EVENTS.INCIDENT_UPDATED, { incident: result.incident });
    }
    return {
      alreadyAcknowledged: result.alreadyAcknowledged,
      response: await this.getResponseView(incidentId),
    };
  }

  /** Fresh backend-authoritative state for one incident. */
  async getResponseView(incidentId: string): Promise<ResponseView> {
    const incident = await this.prisma.incident.findUnique({
      where: { id: incidentId },
      include: { actions: true },
    });
    if (!incident) {
      throw new NotFoundException('Incident not found');
    }
    const [policyEnabled, simulatedIds, facts] = await Promise.all([
      this.isPolicyEnabled(this.prisma),
      readSimulatedFlags(this.prisma, [incidentId]),
      loadResponseAuditFacts(this.prisma, [incidentId]),
    ]);
    return buildResponseView(
      incident,
      incident.actions,
      {
        now: new Date(),
        policyEnabled,
        providerAvailable: this.endpointControl.isAvailable(),
        simulated: isSimulatedIncident(incident, simulatedIds.has(incidentId)),
      },
      facts.get(incidentId) ?? { acknowledgedBy: null, decided: false, decisionReason: null },
    );
  }

  private async processExpired(incidentId: string, now: Date): Promise<void> {
    const decision = await this.decideExpired(incidentId, now);
    if (!decision) return;

    for (const auditLog of decision.audits) {
      this.events.emit(REALTIME_EVENTS.AUDIT_LOG_CREATED, { auditLog });
    }

    if (decision.kind === 'BLOCKED') {
      this.logger.warn(
        `Response window expired for case ${decision.incident.caseId} with no acknowledgement — automated containment not attempted (${decision.reason}).`,
      );
      const result = BLOCKED_NOTIFICATION[decision.reason];
      if (result) await this.notifications.notifyContainmentResult(incidentId, result);
      return;
    }

    this.logger.warn(
      `Response window expired for case ${decision.incident.caseId} with no acknowledgement — executing automated containment (action ${decision.action.id}).`,
    );
    this.events.emit(REALTIME_EVENTS.INCIDENT_ACTION_CREATED, {
      action: decision.action,
      departmentId: decision.incident.departmentId,
      organizationId: decision.incident.organizationId,
    });

    // The PENDING row is committed — only now is the real provider called.
    const finalAction = await this.aiService.completeAutomatedIsolation(
      decision.action.id,
      AUTOMATED_CONTAINMENT_ACTOR,
    );
    if (finalAction && finalAction.outcome !== IncidentActionOutcome.PENDING) {
      await this.notifications.notifyContainmentResult(
        incidentId,
        finalAction.outcome === IncidentActionOutcome.SUCCESS ? 'SUCCEEDED' : 'FAILED',
        finalAction.outcome === IncidentActionOutcome.FAILED ? finalAction.notes : null,
      );
    }
  }

  /**
   * BEGIN → advisory lock → re-read → re-check every condition → once-only
   * decision marker → PENDING action (if eligible) → COMMIT. Returns null
   * when nothing should happen (state changed since the candidate query, or
   * the decision was already taken by another tick/replica).
   */
  private decideExpired(incidentId: string, now: Date): Promise<ExpiryDecision | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockIncident(tx, incidentId);

      const incident = await tx.incident.findUnique({
        where: { id: incidentId },
        include: { actions: true },
      });
      if (!incident) return null;

      const alreadyDecided = await tx.auditLog.findFirst({
        where: { target: incidentId, action: RESPONSE_AUDIT.WINDOW_EXPIRED },
        select: { id: true },
      });
      if (alreadyDecided) return null;

      const simulatedIds = await readSimulatedFlags(tx, [incidentId]);
      const evaluation = evaluateContainmentEligibility(incident, incident.actions, {
        now,
        policyEnabled: await this.isPolicyEnabled(tx),
        providerAvailable: this.endpointControl.isAvailable(),
        simulated: isSimulatedIncident(incident, simulatedIds.has(incidentId)),
      });
      if (!evaluation.atDecisionPoint) return null;

      const audit = (action: string) =>
        tx.auditLog.create({
          data: {
            actorEmail: AUTOMATED_CONTAINMENT_ACTOR,
            action,
            target: incidentId,
            organizationId: incident.organizationId,
          },
        });

      const audits = [await audit(RESPONSE_AUDIT.WINDOW_EXPIRED)];

      if (!evaluation.eligible) {
        const reason = evaluation.reason as ContainmentBlockReason;
        const blockedText = BLOCKED_AUDIT[reason];
        if (blockedText) audits.push(await audit(blockedText));
        return { kind: 'BLOCKED' as const, incident, reason, audits };
      }

      const action = await tx.incidentAction.create({
        data: {
          incidentId,
          type: IncidentActionType.ISOLATE_DEVICE,
          outcome: IncidentActionOutcome.PENDING,
          performedBy: AUTOMATED_CONTAINMENT_ACTOR,
          requestedBy: AUTOMATED_CONTAINMENT_ACTOR,
          approvalStatus: ActionApprovalStatus.NOT_REQUIRED,
          notes:
            'Automated containment: no response within the 5-minute window. Awaiting the endpoint-control provider result.',
        },
      });
      audits.push(await audit(RESPONSE_AUDIT.CONTAINMENT_REQUESTED));
      return { kind: 'CONTAIN' as const, incident, action, audits };
    });
  }

  /** Same lock key as AiService.applyRecommended/updateIncidentStatus, so
   * every writer that can change this incident's response state serializes. */
  private async lockIncident(tx: Prisma.TransactionClient, incidentId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${incidentId}))`;
  }

  /** Fail-closed: a missing policy row means automated containment is off. */
  private async isPolicyEnabled(client: Prisma.TransactionClient | PrismaService): Promise<boolean> {
    const policy = await client.policy.findUnique({ where: { name: RESPONSE_WINDOW_POLICY_NAME } });
    return policy?.enabled === true;
  }
}

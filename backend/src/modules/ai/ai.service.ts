import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ActionApprovalStatus,
  AiAgentName,
  Department,
  Device,
  EventSource,
  Incident,
  IncidentAction,
  IncidentActionOutcome,
  IncidentActionType,
  IncidentEvidence,
  IncidentStatus,
  Indicator,
  Notification,
  NotificationAudience,
  PersistenceFinding,
  Severity,
  Ticket,
  TicketStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import {
  assertDepartmentAccess,
  assertOrganizationAccess,
  departmentScopeWhere,
  organizationScopeWhere,
} from '../../common/guards/department-access.util';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EndpointControlService } from '../devices/endpoint-control/endpoint-control.service';
import { NotificationsService } from '../notifications/notifications.service';
import { REALTIME_EVENTS } from '../websocket/events';
import { AgentAuditService } from './agents/agent-audit.service';
import { CaseIdService } from './case-id/case-id.service';
import { AiProviderRegistry } from './providers/ai-provider.registry';
import { ComparableIncident, compareIncidents } from './comparison/incident-comparison.util';
import {
  buildCandidateSnapshot,
  CORRELATABLE_STATUSES,
  CORRELATION_WINDOW_MS,
  findCorrelatedCase,
} from './correlation/incident-correlation.util';
import { detectC2 } from './detection/c2.util';
import { deriveIndicators } from './detection/indicator.util';
import { detectPersistence } from './detection/persistence.util';
import { enrichFromExcerpt, IncidentEnrichment } from './enrichment/incident-enrichment.util';
import { FIX_CATALOG, GENERIC_FIXES } from './fix-catalog.data';
import { MitreMappingService } from './mitre-attack/mitre-mapping.service';
import { MITRE_REFERENCE, MitreReferenceEntry } from './mitre-attack/mitre-reference.data';
import {
  ANALYST_REPORT_SYSTEM_PROMPT,
  CLASSIFICATION_SYSTEM_PROMPT,
  EMPLOYEE_NOTIFICATION_SYSTEM_PROMPT,
} from './prompts';
import {
  RESPONSE_WINDOW_POLICY_NAME,
  RESPONSE_WINDOW_SEVERITIES,
} from './response-sla/response-sla.constants';
import {
  buildResponseView,
  EMPTY_RESPONSE_AUDIT_FACTS,
  isSimulatedIncident,
  loadResponseAuditFacts,
  readSimulatedFlags,
  ResponseAuditFacts,
} from './response-sla/response-sla.util';
import { RiskPredictionService } from './risk-prediction/risk-prediction.service';
import { sanitizeModelOutputText, wrapUntrustedData } from './security/prompt-guard.util';
import { SimilarityEngineService } from './similarity-engine/similarity-engine.service';
import { AnalyzeLogInput, TriageResult } from './interfaces/triage-result.interface';

const RECOMMENDABLE_ACTIONS = 5;

const HIGH_SEVERITY_TACTICS = new Set([
  'Impact',
  'Command and Control',
  'Privilege Escalation',
  'Exfiltration',
]);
const MEDIUM_SEVERITY_TACTICS = new Set(['Credential Access', 'Persistence', 'Execution']);
const AUTO_TICKET_SEVERITIES = new Set<Severity>([Severity.HIGH, Severity.CRITICAL]);

/** Requirement #6: these action types have real-world consequences on the
 * environment (isolating a device, disabling an account, resetting
 * credentials, killing a process, removing files) and must not be treated
 * as immediately actionable when an AI recommendation is the source — see
 * applyRecommended(). COLLECT_FORENSICS/MONITOR_DEPARTMENT are read-only /
 * observational, so they're excluded from the approval gate. */
const HIGH_IMPACT_ACTION_TYPES = new Set<IncidentActionType>([
  IncidentActionType.ISOLATE_DEVICE,
  IncidentActionType.DISABLE_ACCOUNT,
  IncidentActionType.BLOCK_IP,
  IncidentActionType.BLOCK_HASH,
  IncidentActionType.RESET_PASSWORD,
  IncidentActionType.UPDATE_FIREWALL,
  IncidentActionType.KILL_PROCESS,
  IncidentActionType.REMOVE_MALWARE,
]);

const AI_RECOMMENDATION_REQUESTER = 'ai:recommendation-agent';

const SEVERITY_RANK: Record<Severity, number> = {
  [Severity.LOW]: 0,
  [Severity.MEDIUM]: 1,
  [Severity.HIGH]: 2,
  [Severity.CRITICAL]: 3,
};

/** Severity only ever escalates when evidence is correlated into an existing
 * case — a case can never quietly look less urgent because a later, milder
 * event happened to correlate onto it. */
function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** Phase 8: runtime guard for AI-provider-returned severity — see classify(). */
function isValidSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && (Object.values(Severity) as string[]).includes(value);
}

function formatTicketNumber(ticketNumber: number): string {
  return `TCK-${String(ticketNumber).padStart(6, '0')}`;
}

const UNCLASSIFIED_TECHNIQUE: MitreReferenceEntry = {
  id: 'UNCLASSIFIED',
  name: 'Unclassified Activity',
  tactic: 'Unknown',
  keywords: [],
};

interface ResponseReadContext {
  now: Date;
  policyEnabled: boolean;
  providerAvailable: boolean;
  simulatedIds: Set<string>;
  facts: Map<string, ResponseAuditFacts>;
}

interface StructuredClassificationOutput {
  title: string;
  description: string;
  severity: string;
  mitreTechniqueId: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProvider: AiProviderRegistry,
    private readonly mitre: MitreMappingService,
    private readonly similarity: SimilarityEngineService,
    private readonly auditLogs: AuditLogsService,
    private readonly events: EventEmitter2,
    private readonly riskPrediction: RiskPredictionService,
    private readonly caseIdService: CaseIdService,
    private readonly agentAudit: AgentAuditService,
    private readonly endpointControl: EndpointControlService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Phase 7: `requestingUser`, when given, is the authenticated caller of
   * `POST /ai/analyze` (see AiController.analyze) — this is the one
   * `analyzeLog()` entry point reachable directly by a JWT-authenticated,
   * department-scoped IT_TECHNICIAN with an arbitrary client-supplied
   * `deviceId`. IncidentAccessGuard cannot cover this route (it only checks
   * `:id` path params — see the guard's own comment), so without this check
   * a Finance-department technician could pass an Engineering device's real
   * UUID and have a genuine Incident/Ticket/Notification created with
   * Engineering's own departmentId — a live-confirmed cross-department data
   * injection, closing exactly the same class of gap Phase 1 closed for
   * read paths, but for this create path. The machine-to-machine ingestion
   * callers (MonitoringService, evtx-samples) never pass a user — they
   * resolve deviceId from Wazuh-reported hostname/IP, not raw client input,
   * and are gated by MonitoringApiKeyGuard instead, so they are unaffected.
   */
  /** Phase 9 observability (Section 14): provider health only — never a
   * prompt, incident payload, or any sensitive content. Safe for any of the
   * three SOC-facing roles this controller already allows. */
  getAiProviderStatus() {
    return this.aiProvider.getStatus();
  }

  async analyzeLog(input: AnalyzeLogInput, requestingUser?: AuthenticatedUser) {
    // departmentId/organizationId are never accepted from the caller —
    // both are derived from the device relation so neither can ever drift
    // from where the device actually lives. Phase 2.6B: the org check runs
    // before the department check (assertOrganizationAccess has no
    // role-based exemption, unlike assertDepartmentAccess), closing the
    // same class of cross-department injection Phase 7 fixed for this
    // exact endpoint, now for the organization boundary too — a
    // Finance-department (Org A) technician passing an Engineering-org
    // device's real UUID is rejected here, before any Incident/Ticket/
    // Notification row is created under a device it doesn't belong to.
    let departmentId: string | undefined;
    let organizationId: string | undefined;
    let reportingHostname: string | undefined;
    let device: Device | null = null;
    if (input.deviceId) {
      device = await this.prisma.device.findUnique({ where: { id: input.deviceId } });
      if (!device) {
        throw new NotFoundException('Device not found');
      }
      if (requestingUser) {
        assertOrganizationAccess(requestingUser, device.organizationId);
        assertDepartmentAccess(requestingUser, device.departmentId);
      }
      departmentId = device.departmentId;
      organizationId = device.organizationId;
      reportingHostname = device.hostname;
    }

    const classification = await this.classify(input.sourceExcerpt);
    const enrichment = enrichFromExcerpt(input.sourceExcerpt, reportingHostname);

    if (input.deviceId) {
      const candidates = await this.prisma.incident.findMany({
        where: {
          deviceId: input.deviceId,
          status: { in: CORRELATABLE_STATUSES },
          lastEvidenceAt: { gte: new Date(Date.now() - CORRELATION_WINDOW_MS) },
        },
        include: { device: true },
      });

      if (candidates.length > 0) {
        const snapshot = buildCandidateSnapshot({
          classification,
          enrichment,
          deviceId: input.deviceId,
          departmentId,
          organizationId,
          device,
        });
        const match = findCorrelatedCase(snapshot, candidates);
        if (match) {
          return this.attachEvidence(
            match.incident,
            classification,
            enrichment,
            input,
            match.score,
            reportingHostname,
          );
        }
      }
    } else if (input.rawEvent) {
      // Phase 7: an event whose hostname never resolved to a registered
      // Device has no deviceId to correlate candidates by, so the fuzzy
      // correlation engine above never runs for it — every such event
      // previously became a brand-new Incident (plus its own auto-ticket
      // for HIGH/CRITICAL severity), with zero deduplication. Live-confirmed:
      // replaying one identical unregistered-hostname Wazuh alert 3 times
      // created 3 separate incidents and 3 separate tickets. This narrowly
      // closes just the exact-duplicate case using the one signal genuinely
      // available with no device to key by — the raw event text itself —
      // rather than inventing a new fuzzy-correlation strategy for
      // device-less events (out of scope; would need a real design decision,
      // not a Phase 7 "smallest safe fix").
      const duplicate = await this.prisma.incident.findFirst({
        where: {
          deviceId: null,
          rawEvent: input.rawEvent,
          status: { in: CORRELATABLE_STATUSES },
          lastEvidenceAt: { gte: new Date(Date.now() - CORRELATION_WINDOW_MS) },
        },
        include: { device: true },
      });
      if (duplicate) {
        return this.attachEvidence(duplicate, classification, enrichment, input, 100, reportingHostname);
      }
    }

    return this.createNewCase(classification, enrichment, input, departmentId, organizationId, reportingHostname);
  }

  private async createNewCase(
    classification: TriageResult,
    enrichment: IncidentEnrichment,
    input: AnalyzeLogInput,
    departmentId: string | undefined,
    organizationId: string | undefined,
    reportingHostname: string | undefined,
  ) {
    const caseId = await this.caseIdService.generateNext();
    const ingestSource = input.ingestSource ?? EventSource.MANUAL_TEST;
    const rawEvent = input.rawEvent ?? null;
    const datasetOrigin = input.datasetOrigin ?? null;

    const incident = await this.prisma.incident.create({
      data: {
        caseId,
        title: classification.title,
        description: classification.description,
        severity: classification.severity,
        mitreTechniqueId: classification.technique.id,
        mitreTechniqueName: classification.technique.name,
        mitreTactic: classification.technique.tactic,
        departmentId,
        organizationId,
        deviceId: input.deviceId,
        sourceExcerpt: input.sourceExcerpt,
        generatedBy: classification.generatedBy,
        malwareFamily: enrichment.malwareFamily,
        sourceIp: enrichment.sourceIp,
        sourceCountry: enrichment.sourceCountry,
        destinationAsset: enrichment.destinationAsset,
        iocs: enrichment.iocs,
        detectionRule: enrichment.detectionRule,
        userAccount: enrichment.userAccount,
        ingestSource,
        datasetOrigin,
        rawEvent,
        evidence: {
          create: {
            sourceExcerpt: input.sourceExcerpt,
            severity: classification.severity,
            mitreTechniqueId: classification.technique.id,
            mitreTechniqueName: classification.technique.name,
            mitreTactic: classification.technique.tactic,
            generatedBy: classification.generatedBy,
            iocs: enrichment.iocs,
            ingestSource,
            datasetOrigin,
            rawEvent,
          },
        },
      },
      include: { evidence: true },
    });

    await this.agentAudit.log({
      incidentId: incident.id,
      agent: AiAgentName.INCIDENT_AGENT,
      action: 'classify',
      generatedBy: classification.generatedBy,
      evidenceRefs: [incident.evidence[0].id],
      summary: `Classified as ${classification.technique.id} (${classification.technique.name}), severity ${classification.severity}`,
    });
    await this.runDetection(
      incident.id,
      incident.evidence[0].id,
      input.sourceExcerpt,
      enrichment,
      reportingHostname,
      incident.departmentId,
      incident.organizationId,
    );
    await this.similarity.indexIncident(incident.id);
    this.events.emit(REALTIME_EVENTS.INCIDENT_CREATED, { incident });

    const ticket = AUTO_TICKET_SEVERITIES.has(incident.severity)
      ? await this.prisma.ticket.create({
          data: {
            incidentId: incident.id,
            title: `Investigate: ${incident.title}`,
            severity: incident.severity,
            status: TicketStatus.OPEN,
            departmentId: incident.departmentId,
            organizationId: incident.organizationId,
            deviceId: incident.deviceId,
          },
        })
      : null;

    if (ticket) {
      this.events.emit(REALTIME_EVENTS.TICKET_CREATED, { ticket });
    }

    const employeeNotification = await this.createNotificationSafely(
      () => this.generateEmployeeNotification(incident),
      incident.id,
    );
    const analystNotification = await this.createNotificationSafely(
      () =>
        this.prisma.notification.create({
          data: {
            incidentId: incident.id,
            audience: NotificationAudience.ANALYST,
            title: `New ${incident.severity.toLowerCase()} severity incident`,
            body: `${incident.mitreTechniqueId} ${incident.mitreTechniqueName} detected. ${
              ticket ? 'Ticket auto-created.' : 'Below auto-ticket threshold — monitoring.'
            }`,
          },
        }),
      incident.id,
    );

    // The 5-minute response window starts at createdAt (see
    // ResponseSlaService) — the responsible SOC users are told immediately.
    // NotificationsService never throws, same guarantee as createNotificationSafely.
    if (RESPONSE_WINDOW_SEVERITIES.has(incident.severity)) {
      await this.notifications.notifyResponseRequired(incident.id);
    }

    return {
      incident,
      ticket,
      notifications: [employeeNotification, analystNotification],
      recommendedFixes: classification.recommendedFixes,
    };
  }

  /**
   * A new event scored >=CORRELATION_THRESHOLD against an already-open case
   * on the same device — attach it as evidence instead of spawning a
   * duplicate incident. Severity only ever escalates (maxSeverity), IOCs
   * are unioned, and `lastEvidenceAt` slides forward so the correlation
   * window stays open as long as the case keeps producing evidence. Only an
   * analyst-facing notification is generated here — the employee already
   * got one notice when the case first opened, and every follow-up alert on
   * an already-flagged device isn't new information worth re-notifying them.
   */
  private async attachEvidence(
    existing: Incident,
    classification: TriageResult,
    enrichment: IncidentEnrichment,
    input: AnalyzeLogInput,
    score: number,
    reportingHostname: string | undefined,
  ) {
    const escalatedSeverity = maxSeverity(existing.severity, classification.severity);
    const mergedIocs = Array.from(new Set([...existing.iocs, ...enrichment.iocs]));

    const [evidence, incident] = await this.prisma.$transaction([
      this.prisma.incidentEvidence.create({
        data: {
          incidentId: existing.id,
          sourceExcerpt: input.sourceExcerpt,
          severity: classification.severity,
          mitreTechniqueId: classification.technique.id,
          mitreTechniqueName: classification.technique.name,
          mitreTactic: classification.technique.tactic,
          generatedBy: classification.generatedBy,
          iocs: enrichment.iocs,
          correlationScore: score,
          ingestSource: input.ingestSource ?? EventSource.MANUAL_TEST,
          datasetOrigin: input.datasetOrigin ?? null,
          rawEvent: input.rawEvent ?? null,
        },
      }),
      this.prisma.incident.update({
        where: { id: existing.id },
        data: {
          severity: escalatedSeverity,
          iocs: mergedIocs,
          lastEvidenceAt: new Date(),
        },
      }),
    ]);

    await this.agentAudit.log({
      incidentId: incident.id,
      agent: AiAgentName.INCIDENT_AGENT,
      action: 'classify-correlated-evidence',
      generatedBy: classification.generatedBy,
      confidence: score,
      evidenceRefs: [evidence.id],
      summary: `Classified correlated event as ${classification.technique.id} (${classification.technique.name}); case severity now ${escalatedSeverity}`,
    });
    await this.runDetection(
      incident.id,
      evidence.id,
      input.sourceExcerpt,
      enrichment,
      reportingHostname,
      incident.departmentId,
      incident.organizationId,
    );
    await this.similarity.indexIncident(incident.id);
    this.events.emit(REALTIME_EVENTS.INCIDENT_EVIDENCE_ADDED, { incident, evidence });
    await this.auditLogs.log(
      'system:correlation-engine',
      `Correlated new evidence into existing case (match score ${score}/100)`,
      incident.id,
      // Phase 2.6B: this synthetic system actor has no matching User row
      // for AuditLogsService.log()'s actor-lookup fallback to resolve —
      // passed explicitly from the already-loaded incident instead.
      incident.organizationId,
    );

    const severityJustCrossedThreshold =
      AUTO_TICKET_SEVERITIES.has(escalatedSeverity) &&
      !AUTO_TICKET_SEVERITIES.has(existing.severity);

    let ticket = await this.prisma.ticket.findFirst({
      where: { incidentId: incident.id },
      orderBy: { createdAt: 'desc' },
    });

    if (!ticket && severityJustCrossedThreshold) {
      ticket = await this.prisma.ticket.create({
        data: {
          incidentId: incident.id,
          title: `Investigate: ${incident.title}`,
          severity: incident.severity,
          status: TicketStatus.OPEN,
          departmentId: incident.departmentId,
          organizationId: incident.organizationId,
          deviceId: incident.deviceId,
        },
      });
      this.events.emit(REALTIME_EVENTS.TICKET_CREATED, { ticket });
    }

    const analystNotification = await this.createNotificationSafely(
      () =>
        this.prisma.notification.create({
          data: {
            incidentId: incident.id,
            audience: NotificationAudience.ANALYST,
            title: `New evidence added to ${incident.caseId}`,
            body: `${classification.technique.id} ${classification.technique.name} correlated into this case (match score ${score}/100). Case severity: ${incident.severity}.`,
          },
        }),
      incident.id,
    );

    return {
      incident,
      ticket: ticket ?? null,
      notifications: [analystNotification],
      recommendedFixes: classification.recommendedFixes,
    };
  }

  /**
   * Runs IOC/IOA, C2, and persistence detection over one event's raw text
   * and persists whatever real findings come back — never claims a finding
   * when the evidence is insufficient (each detector returns [] on no
   * match). Findings attach to the existing Case ID (incidentId), the same
   * connective-tissue rule the correlation engine follows: detection
   * modules add evidence to a case, they never spawn a separate incident.
   */
  private async runDetection(
    incidentId: string,
    evidenceId: string,
    sourceExcerpt: string,
    enrichment: IncidentEnrichment,
    reportingHostname: string | undefined,
    departmentId: string | null,
    organizationId: string | null,
  ): Promise<void> {
    const indicatorCandidates = [
      ...deriveIndicators(sourceExcerpt, enrichment),
      ...detectC2(sourceExcerpt),
    ];
    const persistenceCandidates = detectPersistence(sourceExcerpt);

    if (indicatorCandidates.length > 0) {
      await this.prisma.indicator.createMany({
        data: indicatorCandidates.map((candidate) => ({
          incidentId,
          evidenceId,
          category: candidate.category,
          type: candidate.type,
          value: candidate.value,
          description: candidate.description,
          subtype: candidate.subtype,
          mitreTechniqueId: candidate.mitreTechniqueId,
          confidence: candidate.confidence,
        })),
      });
    }

    if (persistenceCandidates.length > 0) {
      await this.prisma.persistenceFinding.createMany({
        data: persistenceCandidates.map((candidate) => ({
          incidentId,
          evidenceId,
          type: candidate.type,
          endpoint: reportingHostname ?? null,
          userAccount: enrichment.userAccount,
          process: candidate.process,
          command: candidate.command,
          evidenceText: candidate.evidenceText,
          mitreTechniqueId: candidate.mitreTechniqueId,
          mitreTechniqueName: candidate.mitreTechniqueName,
          mitreTactic: candidate.mitreTactic,
          confidence: candidate.confidence,
          risk: candidate.risk,
        })),
      });
      await this.auditLogs.log(
        'system:persistence-detection',
        `Detected ${persistenceCandidates.length} persistence indicator(s): ${persistenceCandidates.map((c) => c.type).join(', ')}`,
        incidentId,
        // Phase 2.6B: this synthetic system actor has no matching User row
        // for AuditLogsService.log()'s actor-lookup fallback to resolve —
        // passed explicitly, threaded in from the parent incident.
        organizationId,
      );
      this.events.emit(REALTIME_EVENTS.PERSISTENCE_FINDING_DETECTED, {
        incidentId,
        count: persistenceCandidates.length,
        departmentId,
        organizationId,
      });
    }

    if (indicatorCandidates.length > 0 || persistenceCandidates.length > 0) {
      await this.agentAudit.log({
        incidentId,
        agent: AiAgentName.IOC_IOA_AGENT,
        action: 'scan-evidence',
        generatedBy: 'deterministic',
        evidenceRefs: [evidenceId],
        summary: `Found ${indicatorCandidates.length} IOC/IOA indicator(s) and ${persistenceCandidates.length} persistence finding(s)`,
      });
    }
  }

  /**
   * Phase 1 RBAC/IDOR remediation: previously returned every incident in
   * the system to any authenticated ADMIN/SECURITY_ANALYST/IT_TECHNICIAN —
   * IncidentAccessGuard only ever checked `:id` routes, never this one.
   * departmentScopeWhere() applies the identical department rule
   * assertDepartmentAccess already enforces on GET /ai/incidents/:id.
   */
  async listIncidents(user: AuthenticatedUser) {
    return this.prisma.incident.findMany({
      // Phase 2.6B: organizationScopeWhere() ANDed alongside the existing
      // department scope (spread-safe, non-overlapping keys) — a null-org
      // incident is excluded here by design (organizationScopeWhere uses
      // strict equality, no null-inclusive OR the way department scoping
      // has), never treated as visible to every organization.
      where: { ...departmentScopeWhere(user), ...organizationScopeWhere(user) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { tickets: true },
    });
  }

  async getIncident(id: string) {
    const incident = await this.prisma.incident.findUnique({
      where: { id },
      include: { tickets: true, notifications: true },
    });
    if (!incident) {
      throw new NotFoundException('Incident not found');
    }
    return incident;
  }

  /**
   * The composed "Incident History" record — everything genuinely known
   * about one incident in a single denormalized shape (device/department
   * names, ticket number, response actions, a derived timeline, isolation
   * status, and analyst-authored resolution notes). Every field is either a
   * real stored value or derived from real rows — nothing here is invented.
   */
  async getIncidentHistory(id: string) {
    const incident = await this.prisma.incident.findUnique({
      where: { id },
      include: {
        device: true,
        department: true,
        tickets: true,
        actions: true,
        evidence: true,
        indicators: true,
        persistenceFindings: true,
      },
    });
    if (!incident) {
      throw new NotFoundException('Incident not found');
    }

    return this.composeHistory(incident, await this.loadResponseContext([incident.id]));
  }

  /** Phase 1 RBAC/IDOR remediation: same fix as listIncidents() — see its
   * comment. Phase 2.6B: same organization scoping as listIncidents() too. */
  async listIncidentHistory(user: AuthenticatedUser) {
    const incidents = await this.prisma.incident.findMany({
      where: { ...departmentScopeWhere(user), ...organizationScopeWhere(user) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        device: true,
        department: true,
        tickets: true,
        actions: true,
        evidence: true,
        indicators: true,
        persistenceFindings: true,
      },
    });
    const responseContext = await this.loadResponseContext(incidents.map((incident) => incident.id));
    return incidents.map((incident) => this.composeHistory(incident, responseContext));
  }

  /** Everything buildResponseView() needs beyond the incident row itself —
   * loaded once per request (batched for list endpoints, never per-incident). */
  private async loadResponseContext(incidentIds: string[]): Promise<ResponseReadContext> {
    const [policy, simulatedIds, facts] = await Promise.all([
      this.prisma.policy.findUnique({ where: { name: RESPONSE_WINDOW_POLICY_NAME } }),
      readSimulatedFlags(this.prisma, incidentIds),
      loadResponseAuditFacts(this.prisma, incidentIds),
    ]);
    return {
      now: new Date(),
      // Fail-closed, same as ResponseSlaService: a missing row is "off".
      policyEnabled: policy?.enabled === true,
      providerAvailable: this.endpointControl.isAvailable(),
      simulatedIds,
      facts,
    };
  }

  /** Real IOC/IOA rows for this case — see detection/indicator.util.ts. */
  async listIndicators(incidentId: string) {
    await this.assertIncidentExists(incidentId);
    return this.prisma.indicator.findMany({
      where: { incidentId },
      orderBy: { firstSeenAt: 'desc' },
    });
  }

  /** Real persistence findings for this case — see detection/persistence.util.ts. */
  async listPersistenceFindings(incidentId: string) {
    await this.assertIncidentExists(incidentId);
    return this.prisma.persistenceFinding.findMany({
      where: { incidentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Requirement #29's audit trail — every AI agent decision made on this case. */
  async listAgentDecisions(incidentId: string) {
    await this.assertIncidentExists(incidentId);
    return this.agentAudit.listForIncident(incidentId);
  }

  async updateIncidentStatus(id: string, status: IncidentStatus, actorEmail: string) {
    // Leaving OPEN stamps acknowledgedAt — a response that stops automated
    // containment — so this takes the same per-incident advisory lock as
    // ResponseSlaService's containment decision: the two can never
    // interleave (a status change either lands before the decision and
    // blocks it, or after it and is recorded as a late response).
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const incident = await tx.incident.findUnique({ where: { id } });
      if (!incident) {
        throw new NotFoundException('Incident not found');
      }
      return tx.incident.update({
        where: { id },
        data: {
          status,
          acknowledgedAt:
            status !== IncidentStatus.OPEN && !incident.acknowledgedAt ? new Date() : undefined,
          resolvedAt:
            status === IncidentStatus.RESOLVED && !incident.resolvedAt ? new Date() : undefined,
        },
      });
    });
    await this.auditLogs.log(actorEmail, `Set incident status to "${status}"`, id);
    this.events.emit(REALTIME_EVENTS.INCIDENT_UPDATED, { incident: updated });
    return updated;
  }

  /** Analyst-authored post-incident review text — see UpdateIncidentResolutionDto. */
  async updateIncidentResolution(
    id: string,
    dto: { rootCause?: string; finalResolution?: string; lessonsLearned?: string },
    actorEmail: string,
  ) {
    await this.assertIncidentExists(id);
    const updated = await this.prisma.incident.update({
      where: { id },
      data: {
        rootCause: dto.rootCause,
        finalResolution: dto.finalResolution,
        lessonsLearned: dto.lessonsLearned,
      },
    });
    await this.auditLogs.log(actorEmail, 'Updated incident root cause / resolution notes', id);
    this.events.emit(REALTIME_EVENTS.INCIDENT_UPDATED, { incident: updated });
    return updated;
  }

  async findSimilarIncidents(incidentId: string, user: AuthenticatedUser, limit = 5) {
    return this.similarity.findSimilar(incidentId, user, limit);
  }

  /**
   * The "Similar Attack Analysis" investigation bundle: top-5 similar past
   * incidents ranked by the weighted comparison engine (not the embedding
   * similarity `findSimilarIncidents` above uses — that one stays untouched
   * for IncidentMemoryPage), each with its own real timeline/response
   * history, plus a risk prediction and response recommendations derived
   * only from real `IncidentAction` rows. Recommendations come back empty
   * until analysts actually log actions — there is no seeded history.
   */
  async getInvestigation(incidentId: string, user: AuthenticatedUser) {
    const target = await this.prisma.incident.findUnique({
      where: { id: incidentId },
      include: { device: true },
    });
    if (!target) {
      throw new NotFoundException('Incident not found');
    }

    // Phase 16 (performance/scale review): this previously scanned every
    // incident in the entire database with no department filter and no
    // row limit — a real cross-department data leak (an IT_TECHNICIAN
    // viewing their own department's incident could get another
    // department's full incident details — title, description, device,
    // tickets, actions — back in the "similar past incidents" list if one
    // happened to rank highly) on top of an unbounded, ever-growing scan
    // cost as the incident table grows. `departmentScopeWhere` is the same
    // scoping rule every other collection query in this file already uses
    // (see listIncidents); `take` bounds the comparison pool the same way
    // listIncidents/listIncidentHistory already cap at 200.
    //
    // Phase 2.6B: organizationScopeWhere() applied the same way — a
    // candidate outside the caller's organization is excluded from the
    // comparison pool entirely, never just from the final ranked list, so
    // it can't influence which past incidents get surfaced as "similar"
    // either.
    const deptScope = departmentScopeWhere(user);
    const candidates = await this.prisma.incident.findMany({
      where: {
        id: { not: incidentId },
        ...(deptScope ? { OR: deptScope.OR } : {}),
        ...organizationScopeWhere(user),
      },
      include: { device: true, tickets: true, actions: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const ranked = this.rankByComparison(target as ComparableIncident, candidates).slice(
      0,
      RECOMMENDABLE_ACTIONS,
    );

    const similar = ranked.map(({ candidate, comparison }) => {
      const latestTicket = [...candidate.tickets].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      )[0];
      const durationMs =
        candidate.status !== IncidentStatus.OPEN
          ? candidate.updatedAt.getTime() - candidate.createdAt.getTime()
          : null;

      return {
        incident: candidate,
        score: comparison.score,
        confidence: comparison.confidence,
        dimensions: comparison.dimensions,
        timeline: {
          occurredAt: candidate.createdAt,
          status: candidate.status,
          durationMs,
          resolutionTimeMs: candidate.status === IncidentStatus.RESOLVED ? durationMs : null,
          handledBy: latestTicket?.assignee ?? null,
        },
        actions: candidate.actions,
      };
    });

    const recommendations = this.buildRecommendations(similar.map((entry) => entry.actions));
    const riskPrediction = await this.riskPrediction.predict(target);
    const ownActions = await this.prisma.incidentAction.findMany({
      where: { incidentId },
      orderBy: { createdAt: 'desc' },
    });

    // Suggested Solutions panel: headline summary of the single best
    // historical match, distinct from the full `similar[]` list above. Real
    // data only — `topMatch` is null (never a fabricated 0%/date) when there
    // is nothing to compare against.
    const bestMatch = similar[0];
    const topMatch = bestMatch
      ? {
          incidentId: bestMatch.incident.id,
          caseId: bestMatch.incident.caseId,
          occurredAt: bestMatch.incident.createdAt,
          daysAgo: Math.floor(
            (Date.now() - bestMatch.incident.createdAt.getTime()) / (24 * 60 * 60 * 1000),
          ),
          similarityPercent: bestMatch.score,
          successfulActions: bestMatch.actions.filter(
            (action) => action.outcome === IncidentActionOutcome.SUCCESS,
          ),
        }
      : null;

    await this.agentAudit.log({
      incidentId,
      agent: AiAgentName.MITRE_RISK_AGENT,
      action: 'predict-risk',
      generatedBy: 'deterministic',
      confidence: riskPrediction.confidence,
      summary: `Business impact ${riskPrediction.businessImpact}, lateral movement probability ${riskPrediction.lateralMovementProbability ?? 'insufficient data'} (sample size ${riskPrediction.sampleSize})`,
    });

    if (recommendations.length > 0) {
      await this.agentAudit.log({
        incidentId,
        agent: AiAgentName.RECOMMENDATION_AGENT,
        action: 'recommend-response',
        generatedBy: 'deterministic',
        evidenceRefs: similar.map((entry) => entry.incident.id),
        summary: `Recommended ${recommendations.length} response action type(s) from ${similar.length} similar incident(s)' response history`,
      });
    }

    return {
      similar,
      recommendations,
      recommendationSource: 'deterministic' as const,
      riskPrediction,
      ownActions,
      topMatch,
    };
  }

  private buildRecommendations(
    actionLists: Array<{ type: IncidentActionType; outcome: IncidentActionOutcome }>[],
  ) {
    const successCounts = new Map<IncidentActionType, number>();
    const totalCounts = new Map<IncidentActionType, number>();
    let incidentsWithAnyAction = 0;

    for (const actions of actionLists) {
      if (actions.length > 0) incidentsWithAnyAction += 1;
      for (const action of actions) {
        totalCounts.set(action.type, (totalCounts.get(action.type) ?? 0) + 1);
        if (action.outcome === IncidentActionOutcome.SUCCESS) {
          successCounts.set(action.type, (successCounts.get(action.type) ?? 0) + 1);
        }
      }
    }

    return Array.from(successCounts.entries())
      .map(([type, successCount]) => {
        const totalAttempts = totalCounts.get(type) ?? successCount;
        const humanApprovalRequired = HIGH_IMPACT_ACTION_TYPES.has(type);
        return {
          type,
          successCount,
          totalAttempts,
          sampleSize: incidentsWithAnyAction,
          reason: `Succeeded in ${successCount} of ${totalAttempts} attempt(s) across ${incidentsWithAnyAction} similar incident(s) with recorded response history.`,
          // Real stats only — never shown as a percentage on its own; the UI
          // must fall back to "insufficient historical data" when this is false.
          sufficientData: incidentsWithAnyAction >= 2 && totalAttempts >= 2,
          confidencePercent: totalAttempts > 0 ? Math.round((successCount / totalAttempts) * 100) : 0,
          humanApprovalRequired,
          riskLevel: humanApprovalRequired ? ('HIGH' as const) : ('LOW' as const),
        };
      })
      .sort((a, b) => b.successCount - a.successCount);
  }

  /** Single ranking function shared by getInvestigation()'s viewer-scoped
   * "similar incidents" list and getRecommendedActionTypes()'s org-wide
   * authority check — same weighted comparator (compareIncidents), different
   * (and deliberately different) candidate scoping per caller. */
  private rankByComparison<T extends ComparableIncident>(target: ComparableIncident, candidates: T[]) {
    return candidates
      .map((candidate) => ({ candidate, comparison: compareIncidents(target, candidate) }))
      .sort((a, b) => b.comparison.score - a.comparison.score);
  }

  /**
   * The server-side authority applyRecommended() validates requested types
   * against. Deliberately org-wide rather than viewer-scoped — "is this type currently
   * recommended for this incident" is a property of the incident itself,
   * not of which analyst happens to be asking, and this needs to be
   * computable for any authenticated caller (including internal system
   * callers with no department/organization of their own, e.g. Security
   * Testing Mode), not just a real dashboard viewer. Reuses the exact same
   * comparator/aggregation getInvestigation() uses — no second scoring
   * algorithm.
   */
  private async getRecommendedActionTypes(
    target: ComparableIncident,
  ): Promise<Set<IncidentActionType>> {
    if (!target.organizationId) {
      // No reliable scope to compare against — never guess; an incident
      // with no resolved organization simply has nothing recommended yet.
      return new Set();
    }
    const candidates = await this.prisma.incident.findMany({
      where: { id: { not: target.id }, organizationId: target.organizationId },
      include: { device: true, tickets: true, actions: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const ranked = this.rankByComparison(target, candidates).slice(0, RECOMMENDABLE_ACTIONS);
    const recommendations = this.buildRecommendations(ranked.map((entry) => entry.candidate.actions));
    return new Set(recommendations.map((rec) => rec.type));
  }

  async listIncidentActions(incidentId: string) {
    await this.assertIncidentExists(incidentId);
    return this.prisma.incidentAction.findMany({
      where: { incidentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * A human is calling this directly with their own authenticated identity
   * to record an action — that act of calling it IS the approval, so these
   * never enter the PENDING_APPROVAL gate (see applyRecommended() for the
   * path that does).
   */
  async createIncidentAction(
    incidentId: string,
    dto: { type: IncidentActionType; outcome?: IncidentActionOutcome; notes?: string },
    actorEmail: string,
  ) {
    const incident = await this.prisma.incident.findUnique({
      where: { id: incidentId },
      include: { device: true },
    });
    if (!incident) {
      throw new NotFoundException('Incident not found');
    }

    let outcome = dto.outcome ?? IncidentActionOutcome.PENDING;
    let notes = dto.notes;

    // Requirement #6 / real endpoint-control gap: the client can never
    // assert ISOLATE_DEVICE succeeded on its own say-so — only a real
    // provider response (EndpointControlService) or a later, explicit
    // updateIncidentAction call can move this off PENDING. See
    // EndpointControlService's doc comment for why nothing is configured
    // in this environment yet.
    if (dto.type === IncidentActionType.ISOLATE_DEVICE) {
      if (!incident.deviceId || !incident.device) {
        // Phase 6: a rejected security-sensitive request is itself a
        // security-relevant event — without this, a failed ISOLATE_DEVICE
        // attempt that never got far enough to create an IncidentAction row
        // left zero trace anywhere in the audit trail (only a server log,
        // e.g. from AutoResponsePolicyService's own sweep, which analysts
        // can't see via the app).
        await this.auditLogs.log(
          actorEmail,
          `Rejected response action "${dto.type}" — no device associated with this incident`,
          incidentId,
        );
        throw new BadRequestException('This incident has no associated device to isolate.');
      }
      if (this.endpointControl.isAvailable()) {
        ({ outcome, notes } = await this.executeIsolation(incident.device));
      } else {
        outcome = IncidentActionOutcome.PENDING;
        notes =
          dto.notes ??
          'No automated endpoint-control integration is configured. Perform the isolation via your EDR/network tooling, then confirm the result on this action.';
      }
    }

    const action = await this.prisma.incidentAction.create({
      data: {
        incidentId,
        type: dto.type,
        outcome,
        performedBy: actorEmail,
        notes,
        approvalStatus: ActionApprovalStatus.NOT_REQUIRED,
        requestedBy: actorEmail,
      },
    });
    // Phase 6: the audit text must say what actually happened, not just that
    // a request was processed — "ISOLATE_DEVICE requested" is not the same
    // claim as "ISOLATE_DEVICE succeeded". `outcome` here is always the real,
    // already-resolved result (SUCCESS/FAILED/PENDING) computed above, never
    // a client-asserted value.
    await this.auditLogs.log(
      actorEmail,
      `Logged response action "${dto.type}" — outcome: ${outcome}`,
      incidentId,
    );
    this.events.emit(REALTIME_EVENTS.INCIDENT_ACTION_CREATED, {
      action,
      departmentId: incident.departmentId,
      organizationId: incident.organizationId,
    });

    if (outcome === IncidentActionOutcome.SUCCESS) {
      await this.containIfIsolated(incidentId, dto.type, actorEmail);
    }

    return action;
  }

  /** The one real endpoint-control call for ISOLATE_DEVICE — shared by the
   * analyst path above and completeAutomatedIsolation() below. SUCCESS only
   * ever comes from the provider's own verified result (for Wazuh: the
   * agent's execution callback, see WazuhActiveResponseProvider); every
   * error becomes FAILED with the real reason. */
  private async executeIsolation(
    device: Device,
  ): Promise<{ outcome: IncidentActionOutcome; notes: string }> {
    try {
      const result = await this.endpointControl.isolate(device);
      return {
        outcome: result.success ? IncidentActionOutcome.SUCCESS : IncidentActionOutcome.FAILED,
        notes: result.detail,
      };
    } catch (error) {
      return {
        outcome: IncidentActionOutcome.FAILED,
        notes: error instanceof Error ? error.message : 'Endpoint control provider call failed',
      };
    }
  }

  /**
   * Executes an automated containment whose PENDING IncidentAction was
   * already committed by ResponseSlaService under the per-incident advisory
   * lock — so the provider is only ever called once a durable record of the
   * attempt exists, and a concurrent sweep/replica can never start a second
   * one. Resolves that same row PENDING → SUCCESS/FAILED (never creates
   * another), audits the real outcome, broadcasts it, and marks the incident
   * CONTAINED only on a verified SUCCESS. Returns null if the row is no
   * longer a PENDING ISOLATE_DEVICE action (nothing is executed).
   */
  async completeAutomatedIsolation(actionId: string, actorEmail: string): Promise<IncidentAction | null> {
    const pending = await this.prisma.incidentAction.findUnique({
      where: { id: actionId },
      include: { incident: { include: { device: true } } },
    });
    if (
      !pending ||
      pending.type !== IncidentActionType.ISOLATE_DEVICE ||
      pending.outcome !== IncidentActionOutcome.PENDING
    ) {
      return null;
    }
    const { incident } = pending;

    const { outcome, notes } =
      incident.device && this.endpointControl.isAvailable()
        ? await this.executeIsolation(incident.device)
        : {
            outcome: IncidentActionOutcome.FAILED,
            notes: incident.device
              ? 'Endpoint-control provider is no longer configured — isolation was not executed.'
              : 'This incident has no associated device to isolate.',
          };

    // Conditional on still being PENDING: an analyst resolving the row by
    // hand in the meantime is never overwritten.
    const { count } = await this.prisma.incidentAction.updateMany({
      where: { id: actionId, outcome: IncidentActionOutcome.PENDING },
      data: { outcome, notes },
    });
    const action = await this.prisma.incidentAction.findUniqueOrThrow({ where: { id: actionId } });
    if (count === 0) {
      return action;
    }

    await this.auditLogs.log(
      actorEmail,
      `Automated containment result: "${IncidentActionType.ISOLATE_DEVICE}" — outcome: ${outcome}`,
      incident.id,
      incident.organizationId,
    );
    this.events.emit(REALTIME_EVENTS.INCIDENT_ACTION_UPDATED, {
      action,
      departmentId: incident.departmentId,
      organizationId: incident.organizationId,
    });

    if (outcome === IncidentActionOutcome.SUCCESS) {
      await this.containIfIsolated(incident.id, action.type, actorEmail, incident.organizationId);
    }
    return action;
  }

  async updateIncidentAction(
    incidentId: string,
    actionId: string,
    outcome: IncidentActionOutcome,
    actorEmail: string,
  ) {
    const existing = await this.prisma.incidentAction.findUnique({
      where: { id: actionId },
      include: { incident: { select: { departmentId: true, organizationId: true } } },
    });
    if (!existing || existing.incidentId !== incidentId) {
      throw new NotFoundException('Action not found');
    }

    // Requirement #6: an AI-recommended high-impact action can't move past
    // PENDING until a human has explicitly approved it — and a rejected one
    // can never be executed at all.
    if (
      outcome !== IncidentActionOutcome.PENDING &&
      (existing.approvalStatus === ActionApprovalStatus.PENDING_APPROVAL ||
        existing.approvalStatus === ActionApprovalStatus.REJECTED)
    ) {
      throw new BadRequestException(
        existing.approvalStatus === ActionApprovalStatus.REJECTED
          ? 'This action was rejected and cannot be executed.'
          : 'This action requires analyst approval before its outcome can be recorded.',
      );
    }

    const action = await this.prisma.incidentAction.update({
      where: { id: actionId },
      data: { outcome },
    });
    await this.auditLogs.log(
      actorEmail,
      `Marked response action "${action.type}" as ${outcome}`,
      incidentId,
    );
    this.events.emit(REALTIME_EVENTS.INCIDENT_ACTION_UPDATED, {
      action,
      departmentId: existing.incident.departmentId,
      organizationId: existing.incident.organizationId,
    });

    if (outcome === IncidentActionOutcome.SUCCESS) {
      await this.containIfIsolated(incidentId, action.type, actorEmail);
    }

    return action;
  }

  /** A device confirmed isolated means the case is contained — never
   * inferred from anything except a real SUCCESS ISOLATE_DEVICE outcome,
   * and never regresses a case that's already further along. */
  private async containIfIsolated(
    incidentId: string,
    actionType: IncidentActionType,
    actorEmail: string,
    /** Passed by system actors (no User row to resolve an organization from). */
    organizationId?: string | null,
  ): Promise<void> {
    if (actionType !== IncidentActionType.ISOLATE_DEVICE) return;

    const incident = await this.prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) return;
    if (
      incident.status === IncidentStatus.CONTAINED ||
      incident.status === IncidentStatus.RESOLVED ||
      incident.status === IncidentStatus.CLOSED
    ) {
      return;
    }

    const updated = await this.prisma.incident.update({
      where: { id: incidentId },
      data: { status: IncidentStatus.CONTAINED },
    });
    await this.auditLogs.log(
      actorEmail,
      'Incident automatically marked CONTAINED after confirmed device isolation',
      incidentId,
      organizationId,
    );
    this.events.emit(REALTIME_EVENTS.INCIDENT_UPDATED, { incident: updated });
  }

  /**
   * Requirement #6: AI may recommend, it must never execute. Every
   * high-impact recommended action (see HIGH_IMPACT_ACTION_TYPES) is created
   * PENDING_APPROVAL — an analyst must call approveIncidentAction() before
   * its outcome can be recorded via updateIncidentAction(). Lower-impact
   * observational types (COLLECT_FORENSICS, MONITOR_DEPARTMENT) skip the
   * gate since they have no real-world side effect to approve.
   *
   * Hardening (live-smoke-test follow-up): the client's requested `types`
   * are never trusted as-is —
   *  1. Every type must appear in this incident's OWN current recommendation
   *     set (see getRecommendedActionTypes — the same real, deterministic,
   *     historical-success computation getInvestigation() uses, computed
   *     org-wide rather than viewer-scoped since this is a server-side
   *     authority check, not data shown to one particular viewer) or the
   *     whole request is rejected atomically before any row is written.
   *  2. An incident+type pair that already has an IncidentAction (any
   *     outcome/approval status) is never duplicated — the existing row is
   *     returned instead, with no new EndpointControlService/Wazuh call,
   *     audit line, or realtime event for it.
   *  3. A Postgres advisory transaction lock keyed on the incident id
   *     serializes concurrent calls for the same incident, so two
   *     simultaneous requests can never both pass the "no existing action"
   *     check before either writes — no schema migration/unique constraint
   *     needed, and the lock releases automatically at commit/rollback.
   * Still never calls EndpointControlService — this method only ever
   * writes a PENDING/PENDING_APPROVAL bookkeeping row, exactly as before.
   */
  async applyRecommended(incidentId: string, types: IncidentActionType[], actorEmail: string) {
    const target = await this.prisma.incident.findUnique({
      where: { id: incidentId },
      include: { device: true },
    });
    if (!target) {
      throw new NotFoundException('Incident not found');
    }
    const { departmentId, organizationId } = target;

    const recommendedTypes = await this.getRecommendedActionTypes(target as ComparableIncident);
    const notRecommended = types.filter((type) => !recommendedTypes.has(type));
    if (notRecommended.length > 0) {
      throw new BadRequestException(
        `The following action type(s) are not currently recommended for this incident: ${notRecommended.join(', ')}.`,
      );
    }

    const { actions, createdTypes } = await this.prisma.$transaction(async (tx) => {
      // Serializes concurrent applyRecommended calls for this exact
      // incident — released automatically when the transaction ends.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${incidentId}))`;

      const existing = await tx.incidentAction.findMany({
        where: { incidentId, type: { in: types } },
      });
      const existingByType = new Map(existing.map((action) => [action.type, action]));

      const resultActions: IncidentAction[] = [];
      const created: IncidentActionType[] = [];
      for (const type of types) {
        const existingAction = existingByType.get(type);
        if (existingAction) {
          resultActions.push(existingAction);
          continue;
        }
        const requiresApproval = HIGH_IMPACT_ACTION_TYPES.has(type);
        const action = await tx.incidentAction.create({
          data: {
            incidentId,
            type,
            outcome: IncidentActionOutcome.PENDING,
            performedBy: actorEmail,
            approvalStatus: requiresApproval
              ? ActionApprovalStatus.PENDING_APPROVAL
              : ActionApprovalStatus.NOT_REQUIRED,
            requestedBy: AI_RECOMMENDATION_REQUESTER,
            notes: requiresApproval
              ? 'AI-recommended action — awaiting analyst approval.'
              : undefined,
          },
        });
        resultActions.push(action);
        created.push(type);
      }
      return { actions: resultActions, createdTypes: created };
    });

    // Audit/realtime only for what was actually newly created — a
    // duplicate request that resolved entirely to pre-existing rows leaves
    // no new trace, per the "no duplicate audit entries" requirement.
    if (createdTypes.length > 0) {
      for (const action of actions) {
        if (createdTypes.includes(action.type)) {
          this.events.emit(REALTIME_EVENTS.INCIDENT_ACTION_CREATED, {
            action,
            departmentId,
            organizationId,
          });
        }
      }
      await this.auditLogs.log(
        actorEmail,
        `Applied recommended response (${createdTypes.join(', ')})`,
        incidentId,
      );
    }
    return actions;
  }

  /** Requirement #6's human-in-the-loop gate: an analyst explicitly signs off
   * on a high-impact AI-recommended action before it can be executed. */
  async approveIncidentAction(incidentId: string, actionId: string, actorEmail: string) {
    const existing = await this.prisma.incidentAction.findUnique({
      where: { id: actionId },
      include: { incident: { select: { departmentId: true, organizationId: true } } },
    });
    if (!existing || existing.incidentId !== incidentId) {
      throw new NotFoundException('Action not found');
    }
    if (existing.approvalStatus !== ActionApprovalStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Only actions pending approval can be approved.');
    }

    const action = await this.prisma.incidentAction.update({
      where: { id: actionId },
      data: {
        approvalStatus: ActionApprovalStatus.APPROVED,
        approvedBy: actorEmail,
        approvedAt: new Date(),
      },
    });
    await this.auditLogs.log(actorEmail, `Approved response action "${action.type}"`, incidentId);
    this.events.emit(REALTIME_EVENTS.INCIDENT_ACTION_UPDATED, {
      action,
      departmentId: existing.incident.departmentId,
      organizationId: existing.incident.organizationId,
    });
    return action;
  }

  async rejectIncidentAction(
    incidentId: string,
    actionId: string,
    actorEmail: string,
    reason: string | undefined,
  ) {
    const existing = await this.prisma.incidentAction.findUnique({
      where: { id: actionId },
      include: { incident: { select: { departmentId: true, organizationId: true } } },
    });
    if (!existing || existing.incidentId !== incidentId) {
      throw new NotFoundException('Action not found');
    }
    if (existing.approvalStatus !== ActionApprovalStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Only actions pending approval can be rejected.');
    }

    const action = await this.prisma.incidentAction.update({
      where: { id: actionId },
      data: {
        approvalStatus: ActionApprovalStatus.REJECTED,
        approvedBy: actorEmail,
        approvedAt: new Date(),
        rejectedReason: reason,
      },
    });
    await this.auditLogs.log(actorEmail, `Rejected response action "${action.type}"`, incidentId);
    this.events.emit(REALTIME_EVENTS.INCIDENT_ACTION_UPDATED, {
      action,
      departmentId: existing.incident.departmentId,
      organizationId: existing.incident.organizationId,
    });
    return action;
  }

  /** Returns the incident's departmentId/organizationId (not just void) so
   * callers that need them for a realtime-event payload (see
   * applyRecommended) don't have to run a second query — existing callers
   * that only awaited this for its existence check are unaffected. */
  private async assertIncidentExists(
    incidentId: string,
  ): Promise<{ departmentId: string | null; organizationId: string | null }> {
    const exists = await this.prisma.incident.findUnique({
      where: { id: incidentId },
      select: { departmentId: true, organizationId: true },
    });
    if (!exists) {
      throw new NotFoundException('Incident not found');
    }
    return exists;
  }

  private composeHistory(
    incident: Incident & {
      device: Device | null;
      department: Department | null;
      tickets: Ticket[];
      actions: IncidentAction[];
      evidence: IncidentEvidence[];
      indicators: Indicator[];
      persistenceFindings: PersistenceFinding[];
    },
    responseContext: ResponseReadContext,
  ) {
    const latestTicket = [...incident.tickets].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];

    const latestIsolation = incident.actions
      .filter(
        (action) =>
          action.type === IncidentActionType.ISOLATE_DEVICE &&
          action.outcome === IncidentActionOutcome.SUCCESS,
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

    const completedCount = incident.actions.filter(
      (action) => action.outcome === IncidentActionOutcome.SUCCESS,
    ).length;

    return {
      id: incident.id,
      caseId: incident.caseId,
      ticketNumber: latestTicket ? formatTicketNumber(latestTicket.ticketNumber) : null,
      title: incident.title,
      description: incident.description,

      detectedAt: incident.createdAt,
      acknowledgedAt: incident.acknowledgedAt,
      resolvedAt: incident.resolvedAt,

      /// The authoritative 5-minute response window state (see
      /// ResponseSlaService) — the UI only renders this, it never computes a
      /// deadline or eligibility of its own.
      response: buildResponseView(
        incident,
        incident.actions,
        {
          now: responseContext.now,
          policyEnabled: responseContext.policyEnabled,
          providerAvailable: responseContext.providerAvailable,
          simulated: isSimulatedIncident(incident, responseContext.simulatedIds.has(incident.id)),
        },
        responseContext.facts.get(incident.id) ?? EMPTY_RESPONSE_AUDIT_FACTS,
      ),

      departmentId: incident.departmentId,
      departmentName: incident.department?.name ?? null,

      deviceId: incident.deviceId,
      deviceName: incident.device?.hostname ?? null,
      deviceIp: incident.device?.ipAddress ?? null,
      deviceType: incident.device?.deviceType ?? null,
      operatingSystem: incident.device?.os ?? null,

      attackType: incident.mitreTechniqueName,
      attackCategory: incident.mitreTactic,
      mitreTechniqueId: incident.mitreTechniqueId,
      mitreTechniqueName: incident.mitreTechniqueName,

      severity: incident.severity,
      status: incident.status,

      indicatorsOfCompromise: incident.iocs,
      source: incident.sourceIp,
      destination: incident.destinationAsset,
      userAccount: incident.userAccount,

      /// Provenance — where this case's founding event actually came from
      /// (see EventSource). Lets the UI clearly separate real open-source
      /// dataset evidence from Simulation Mode/manual traffic instead of
      /// presenting both identically.
      ingestSource: incident.ingestSource,
      datasetOrigin: incident.datasetOrigin,
      rawEvent: incident.rawEvent,

      actionsTaken: incident.actions.map((action) => this.toResponseAction(action)),
      timeline: this.buildTimeline(incident),

      /// Every correlated event this case has absorbed since it opened — the
      /// founding event (correlationScore: null) plus each subsequent merge.
      evidenceCount: incident.evidence.length,
      evidence: incident.evidence
        .slice()
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((item) => ({
          id: item.id,
          sourceExcerpt: item.sourceExcerpt,
          severity: item.severity,
          mitreTechniqueId: item.mitreTechniqueId,
          mitreTechniqueName: item.mitreTechniqueName,
          correlationScore: item.correlationScore,
          createdAt: item.createdAt,
          ingestSource: item.ingestSource,
          datasetOrigin: item.datasetOrigin,
          rawEvent: item.rawEvent,
        })),

      /// Real IOC/IOA rows (detection/indicator.util.ts + detection/c2.util.ts)
      /// — empty when the evidence text contains no matching signal, never fabricated.
      indicators: incident.indicators.map((item) => ({
        id: item.id,
        category: item.category,
        type: item.type,
        value: item.value,
        description: item.description,
        subtype: item.subtype,
        mitreTechniqueId: item.mitreTechniqueId,
        confidence: item.confidence,
        firstSeenAt: item.firstSeenAt,
        lastSeenAt: item.lastSeenAt,
      })),

      /// Real persistence findings (detection/persistence.util.ts) — see
      /// requirement #27: never claims persistence when evidence is insufficient.
      persistenceFindings: incident.persistenceFindings.map((item) => ({
        id: item.id,
        type: item.type,
        endpoint: item.endpoint,
        userAccount: item.userAccount,
        process: item.process,
        command: item.command,
        evidenceText: item.evidenceText,
        mitreTechniqueId: item.mitreTechniqueId,
        mitreTechniqueName: item.mitreTechniqueName,
        mitreTactic: item.mitreTactic,
        confidence: item.confidence,
        risk: item.risk,
        createdAt: item.createdAt,
      })),

      isolated: Boolean(latestIsolation),
      isolatedAt: latestIsolation?.updatedAt ?? null,
      isolatedBy: latestIsolation?.performedBy ?? null,

      rootCause: incident.rootCause,
      finalResolution: incident.finalResolution,
      lessonsLearned: incident.lessonsLearned,

      analystName: latestTicket?.assignee ?? null,
      resolutionTimeMinutes: incident.resolvedAt
        ? Math.round((incident.resolvedAt.getTime() - incident.createdAt.getTime()) / 60000)
        : null,
      responseSuccessRate:
        incident.actions.length > 0
          ? Math.round((completedCount / incident.actions.length) * 100)
          : null,

      /** Same static, technique-keyed catalog the AI triage pipeline itself recommends at classification time. */
      recommendedFixes: FIX_CATALOG[incident.mitreTechniqueId] ?? GENERIC_FIXES,

      createdAt: incident.createdAt,
      updatedAt: incident.updatedAt,
    };
  }

  private toResponseAction(action: IncidentAction) {
    const title = action.type
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());

    const STATUS_MAP: Record<IncidentActionOutcome, 'pending' | 'completed' | 'failed'> = {
      [IncidentActionOutcome.PENDING]: 'pending',
      [IncidentActionOutcome.SUCCESS]: 'completed',
      [IncidentActionOutcome.FAILED]: 'failed',
    };

    return {
      id: action.id,
      actionType: action.type,
      title,
      description: action.notes ?? '',
      executedAt: action.outcome !== IncidentActionOutcome.PENDING ? action.updatedAt : null,
      executedBy: action.performedBy,
      status: STATUS_MAP[action.outcome],
      result: action.notes ?? null,
      // Lets the UI tell "PENDING because an AI-recommended high-impact
      // action is still awaiting analyst sign-off" apart from "PENDING
      // because no automated endpoint-control integration is configured and
      // an analyst must confirm the real-world result manually" — both
      // previously collapsed to the same bare `status: 'pending'` with no
      // way to distinguish them.
      approvalStatus: action.approvalStatus,
    };
  }

  /**
   * Assembled from real timestamped rows already in the DB — detected →
   * acknowledged → ticket(s) created → action(s) logged/updated → resolved.
   * Not a stored table: recomputed on every read so it can never drift from
   * the rows it's built from.
   */
  private buildTimeline(
    incident: Incident & {
      tickets: Ticket[];
      actions: IncidentAction[];
      evidence: IncidentEvidence[];
      persistenceFindings: PersistenceFinding[];
    },
  ) {
    const entries: {
      timestamp: Date;
      event: string;
      description?: string;
      performedBy?: string;
    }[] = [
      { timestamp: incident.createdAt, event: 'Incident detected', description: incident.title },
    ];

    // Only correlated merges (correlationScore set) get their own entry —
    // the founding evidence row's timestamp already coincides with
    // "Incident detected" above, so it isn't shown a second time.
    for (const item of incident.evidence) {
      if (item.correlationScore === null) continue;
      entries.push({
        timestamp: item.createdAt,
        event: `New evidence correlated into this case (match score ${item.correlationScore}/100)`,
        description: `${item.mitreTechniqueId} ${item.mitreTechniqueName}`,
      });
    }

    for (const finding of incident.persistenceFindings) {
      entries.push({
        timestamp: finding.createdAt,
        event: `Persistence detected: ${finding.type.replace(/_/g, ' ').toLowerCase()}`,
        description: `${finding.mitreTechniqueId} ${finding.mitreTechniqueName} (confidence ${finding.confidence}%, risk ${finding.risk})`,
      });
    }

    if (incident.acknowledgedAt) {
      entries.push({ timestamp: incident.acknowledgedAt, event: 'Incident acknowledged' });
    }

    for (const ticket of incident.tickets) {
      entries.push({
        timestamp: ticket.createdAt,
        event: `Ticket ${formatTicketNumber(ticket.ticketNumber)} created`,
        description: ticket.title,
      });
    }

    for (const action of incident.actions) {
      entries.push({
        timestamp: action.createdAt,
        event: `Response action logged: ${action.type}`,
        performedBy: action.performedBy,
      });
      if (
        action.outcome !== IncidentActionOutcome.PENDING &&
        action.updatedAt.getTime() !== action.createdAt.getTime()
      ) {
        entries.push({
          timestamp: action.updatedAt,
          event: `Response action "${action.type}" marked ${action.outcome.toLowerCase()}`,
          performedBy: action.performedBy,
        });
      }
    }

    if (incident.resolvedAt) {
      entries.push({ timestamp: incident.resolvedAt, event: 'Incident resolved' });
    }

    return entries
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map((entry, index) => ({ id: `tl-${index}`, ...entry }));
  }

  async generateAnalystReport(
    incidentId: string,
  ): Promise<{ report: string; generatedBy: string }> {
    const incident = await this.prisma.incident.findUniqueOrThrow({
      where: { id: incidentId },
      include: { tickets: true },
    });

    if (this.aiProvider.isAvailable()) {
      try {
        const report = await this.aiProvider.generateText({
          systemPrompt: ANALYST_REPORT_SYSTEM_PROMPT,
          // Wrapped: title/description/sourceExcerpt all trace back to raw
          // log text an attacker may have influenced (see prompt-guard.util.ts).
          userPrompt: wrapUntrustedData(
            JSON.stringify({
              title: incident.title,
              description: incident.description,
              severity: incident.severity,
              mitreTechniqueId: incident.mitreTechniqueId,
              mitreTechniqueName: incident.mitreTechniqueName,
              mitreTactic: incident.mitreTactic,
              sourceExcerpt: incident.sourceExcerpt,
              status: incident.status,
              ticketCount: incident.tickets.length,
            }),
          ),
          effort: 'high',
          maxTokens: 2048,
        });
        return { report, generatedBy: this.aiProvider.providerId ?? 'rule-based-fallback' };
      } catch (error) {
        this.logger.warn(
          `AI provider report generation failed, using template: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    return { report: this.templatedAnalystReport(incident), generatedBy: 'rule-based-fallback' };
  }

  private async classify(sourceExcerpt: string): Promise<TriageResult> {
    if (this.aiProvider.isAvailable()) {
      try {
        const schema = {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
            mitreTechniqueId: { type: 'string', enum: MITRE_REFERENCE.map((t) => t.id) },
          },
          required: ['title', 'description', 'severity', 'mitreTechniqueId'],
          additionalProperties: false,
        };

        const result = await this.aiProvider.generateStructured<StructuredClassificationOutput>({
          systemPrompt: CLASSIFICATION_SYSTEM_PROMPT,
          // sourceExcerpt is raw Wazuh/Suricata/Sysmon/etc. text an attacker
          // may control — delimited per requirement #28 (prompt-guard.util.ts).
          userPrompt: wrapUntrustedData(sourceExcerpt),
          schema,
          effort: 'low',
          maxTokens: 1024,
        });

        // Guard against a hallucinated technique ID rather than trusting the model's string verbatim.
        const technique =
          this.mitre.getById(result.mitreTechniqueId) ?? this.ruleBasedTechnique(sourceExcerpt);

        // Phase 8: `severity` was previously trusted via a bare TypeScript
        // cast (`as Severity`) with no runtime check — harmless against
        // Claude's schema-constrained output, but a self-hosted/local model
        // is far less reliable at strictly honoring an enum, and a
        // malformed value here would have thrown an unhandled Postgres
        // enum-constraint error deep inside the incident-create call rather
        // than degrading gracefully. Now explicitly validated with a safe,
        // deterministic fallback instead of trusting the model's output.
        const severity = isValidSeverity(result.severity)
          ? result.severity
          : this.severityForTactic(technique.tactic);

        return {
          // Model output is free text — clamp/strip before it gets persisted
          // and re-displayed/re-prompted elsewhere (see prompt-guard.util.ts).
          title: sanitizeModelOutputText(result.title, 200),
          description: sanitizeModelOutputText(result.description, 1000),
          severity,
          technique: { id: technique.id, name: technique.name, tactic: technique.tactic },
          recommendedFixes: FIX_CATALOG[technique.id] ?? GENERIC_FIXES,
          generatedBy: this.aiProvider.providerId ?? 'rule-based-fallback',
        };
      } catch (error) {
        this.logger.warn(
          `AI provider classification failed, falling back to rule-based triage: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    return this.ruleBasedClassify(sourceExcerpt);
  }

  private ruleBasedTechnique(text: string): MitreReferenceEntry {
    return this.mitre.match(text)?.technique ?? UNCLASSIFIED_TECHNIQUE;
  }

  private ruleBasedClassify(sourceExcerpt: string): TriageResult {
    const match = this.mitre.match(sourceExcerpt);
    const technique = match?.technique ?? UNCLASSIFIED_TECHNIQUE;
    const severity = match ? this.severityForTactic(match.technique.tactic) : Severity.LOW;

    return {
      title: match ? `${match.technique.name} detected` : 'Unclassified security event',
      description: sourceExcerpt.slice(0, 500),
      severity,
      technique: { id: technique.id, name: technique.name, tactic: technique.tactic },
      recommendedFixes: FIX_CATALOG[technique.id] ?? GENERIC_FIXES,
      generatedBy: 'rule-based-fallback',
    };
  }

  private severityForTactic(tactic: string): Severity {
    if (HIGH_SEVERITY_TACTICS.has(tactic)) return Severity.HIGH;
    if (MEDIUM_SEVERITY_TACTICS.has(tactic)) return Severity.MEDIUM;
    return Severity.LOW;
  }

  /**
   * Phase 15 (production failure-mode testing): `Notification` rows are
   * informational only — write-only, never read by either frontend (see
   * the original security-baseline finding). A transient failure creating
   * one (e.g. a brief DB hiccup) must never fail the incident/evidence
   * write it's attached to — that write already fully succeeded and was
   * already broadcast over the realtime gateway by the time this runs
   * (see the emit calls above each of this method's two call sites).
   * Letting a notification-write failure propagate would report a false
   * failure for a security-relevant operation (incident creation/
   * correlation) that actually succeeded, and could trigger an
   * unnecessary re-ingestion retry from whatever called in (Wazuh/
   * Suricata/etc. re-POSTing the same event after seeing a 500) for
   * something Phase 7's correlation engine would very likely just
   * re-absorb as duplicate evidence rather than actually recover anything
   * by retrying. The incident/ticket/audit/detection writes above this
   * are deliberately NOT wrapped this way — those are the real security
   * record, and a failure there should fail the whole request.
   */
  private async createNotificationSafely(
    create: () => Promise<Notification>,
    incidentId: string,
  ): Promise<Notification | null> {
    try {
      return await create();
    } catch (error) {
      this.logger.warn(
        `Failed to create a notification for incident ${incidentId} — the incident/evidence itself was already saved successfully: ${
          error instanceof Error ? error.message : error
        }`,
      );
      return null;
    }
  }

  private async generateEmployeeNotification(incident: Incident) {
    let body: string;

    if (this.aiProvider.isAvailable()) {
      try {
        body = sanitizeModelOutputText(
          await this.aiProvider.generateText({
            systemPrompt: EMPLOYEE_NOTIFICATION_SYSTEM_PROMPT,
            // title/description already passed through classify()'s sanitizer
            // once, but are still wrapped here for defense-in-depth — they
            // remain attacker-influenced free text (see prompt-guard.util.ts).
            userPrompt: wrapUntrustedData(
              `Incident: ${incident.title}\nDetails: ${incident.description}\nSeverity: ${incident.severity}`,
            ),
            effort: 'low',
            maxTokens: 300,
          }),
          600,
        );
      } catch (error) {
        this.logger.warn(
          `AI provider notification generation failed, using template: ${error instanceof Error ? error.message : error}`,
        );
        body = this.templatedEmployeeNotification(incident);
      }
    } else {
      body = this.templatedEmployeeNotification(incident);
    }

    return this.prisma.notification.create({
      data: {
        incidentId: incident.id,
        audience: NotificationAudience.EMPLOYEE,
        title: 'Security notice regarding your device',
        body,
      },
    });
  }

  private templatedEmployeeNotification(incident: Incident): string {
    return `We detected unusual activity (${incident.mitreTechniqueName.toLowerCase()}) related to your device and our security team is reviewing it. You don't need to do anything right now — we'll follow up if any action is needed on your part.`;
  }

  private templatedAnalystReport(incident: Incident & { tickets: Ticket[] }): string {
    return [
      `# Incident Report — ${incident.title}`,
      '',
      `**Severity:** ${incident.severity}`,
      `**MITRE ATT&CK:** ${incident.mitreTechniqueId} — ${incident.mitreTechniqueName} (${incident.mitreTactic})`,
      `**Status:** ${incident.status}`,
      `**Linked tickets:** ${incident.tickets.length}`,
      '',
      '## Description',
      incident.description,
      '',
      '## Source excerpt',
      incident.sourceExcerpt,
      '',
      '_This is a template-generated report — the Claude API was unavailable when it was created._',
    ].join('\n');
  }
}

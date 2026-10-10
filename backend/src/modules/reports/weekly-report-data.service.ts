import { Injectable } from '@nestjs/common';
import {
  ActionApprovalStatus,
  EventSource,
  IncidentActionType,
  IncidentStatus,
  Severity,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { ReportPeriod } from './weekly-report-period.util';

const RESOLVED_STATUSES: IncidentStatus[] = [IncidentStatus.RESOLVED, IncidentStatus.CLOSED];
const OPEN_STATUSES: IncidentStatus[] = [
  IncidentStatus.OPEN,
  IncidentStatus.INVESTIGATING,
  IncidentStatus.CONTAINED,
];
/** Same per-severity point cost DevicesService.SEVERITY_PENALTY uses for its
 * live "right now" device risk score — reused here so the report's
 * period-scoped risk score is computed by the identical real formula, just
 * against this reporting period's incidents instead of "the last 5
 * minutes" (see `computeAffectedAssets` for why a live snapshot has no
 * meaningful place inside a report about a past week). */
const SEVERITY_PENALTY: Record<Severity, number> = {
  LOW: 2,
  MEDIUM: 8,
  HIGH: 18,
  CRITICAL: 30,
};
const DEFAULT_BASELINE_SCORE = 85;

export type DerivedRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** The one approved derivation rule for "Overall Security Risk" (and,
 * applied per-department below, "Department Risk") — a management metric
 * computed at render/report time from real open-incident counts, never
 * stored in the database:
 *   1. Any OPEN CRITICAL incident            -> CRITICAL
 *   2. Else any OPEN HIGH incident, or 3+ OPEN incidents -> HIGH
 *   3. Else any OPEN incident                 -> MEDIUM
 *   4. Else                                   -> LOW
 */
export function deriveRiskLevel(openBySeverity: Record<Severity, number>): DerivedRiskLevel {
  const totalOpen =
    openBySeverity.LOW + openBySeverity.MEDIUM + openBySeverity.HIGH + openBySeverity.CRITICAL;
  if (openBySeverity.CRITICAL > 0) return 'CRITICAL';
  if (openBySeverity.HIGH > 0 || totalOpen >= 3) return 'HIGH';
  if (totalOpen > 0) return 'MEDIUM';
  return 'LOW';
}

export interface WeeklyReportData {
  period: ReportPeriod;
  executiveSummary: {
    totalAlerts: number;
    alertsBySeverity: Record<Severity, number>;
    totalIncidents: number;
    openIncidents: number;
    resolvedIncidents: number;
    ticketsCreated: number;
    ticketsResolved: number;
    /** null = insufficient data (no incident created this period has resolvedAt set). */
    avgResolutionTimeMs: number | null;
  };
  incidentOverview: {
    byAttackType: Array<{ label: string; count: number }>;
    bySeverity: Array<{ label: string; count: number }>;
    byDepartment: Array<{ label: string; count: number }>;
    byEndpoint: Array<{ label: string; count: number }>;
    byStatus: Array<{ label: string; count: number }>;
    /// How many of this period's cases came from a real open-source-dataset
    /// replay vs. synthetic Simulation Mode vs. a live agent vs. an ad-hoc
    /// manual/test call — see EventSource. Keeps demo/simulation traffic
    /// visibly separate from real evidence in the report, never blended
    /// into one undifferentiated "incidents" figure.
    byIngestSource: Array<{ label: string; count: number }>;
  };
  mitreOverview: Array<{
    techniqueId: string;
    techniqueName: string;
    tactic: string;
    occurrences: number;
  }>;
  iocIoaOverview: {
    topIocTypes: Array<{ type: string; count: number }>;
    repeatedIocs: Array<{ value: string; occurrences: number }>;
    topIoas: Array<{ subtype: string; count: number }>;
    persistenceFindings: Array<{ type: string; count: number }>;
    c2Indicators: Array<{ subtype: string; count: number }>;
  };
  aiPerformance: {
    classificationsPerformed: number;
    claudeGenerated: number;
    ruleBasedFallback: number;
    confidenceDistribution: Array<{ bucket: string; count: number }>;
    approvedActions: number;
    rejectedActions: number;
  };
  responseSummary: {
    byActionType: Array<{ type: IncidentActionType; count: number }>;
    closedIncidents: number;
    ticketsCount: number;
    actions: Array<{
      caseId: string;
      type: IncidentActionType;
      endpoint: string | null;
      analyst: string;
      /** Real 'ai:...'-prefixed requestedBy vs. an analyst email — see
       * IncidentAction.requestedBy — never inferred from the action type. */
      automated: boolean;
      timestamp: Date;
      result: string;
    }>;
    /** true when `actions` was capped — see MAX_RESPONSE_ACTION_ROWS. */
    truncated: boolean;
  };
  trends: {
    /** false when there's no prior week of data at all to compare against. */
    hasSufficientHistory: boolean;
    previousWeekTotalAlerts: number | null;
    previousWeekTotalIncidents: number | null;
    alertsDeltaPct: number | null;
    incidentsDeltaPct: number | null;
  };
  /** Real open-incident severity breakdown for this period/organization —
   * feeds the PDF's "Overall Security Risk" banner via deriveRiskLevel().
   * Never persisted; purely a render-time aggregate. */
  openIncidentsBySeverity: Record<Severity, number>;
  /** Weekly SOC PDF redesign — everything above this field predates it and
   * is untouched. The three fields below are additive: real, org+period-
   * scoped data the aggregated fields above can't express (individual
   * incident rows, per-asset/per-department rollups). */
  topIncidents: Array<{
    caseId: string;
    severity: Severity;
    status: IncidentStatus;
    deviceName: string | null;
    departmentName: string | null;
    detectionRule: string | null;
    ingestSource: EventSource;
    mitreTechniqueId: string;
    mitreTechniqueName: string;
    mitreTactic: string;
    createdAt: Date;
    resolvedAt: Date | null;
    resolutionTimeMs: number | null;
    description: string;
    /** Analyst-authored post-incident review text — null until an analyst
     * fills it in; never fabricated when missing (see Incident.rootCause). */
    rootCause: string | null;
    finalResolution: string | null;
  }>;
  /** Per-device rollup for "Top Affected Assets". `riskScore`/`status`/
   * `isolated` are period-scoped analogues of DevicesService's own live
   * "right now" computation — recomputed here against *this reporting
   * period's* incidents/actions instead of "the last 5 minutes", since a
   * live snapshot has no meaningful place inside a report about a past
   * week (see deriveRiskLevel's doc comment for the parallel reasoning on
   * the org-wide risk banner). */
  affectedAssets: Array<{
    deviceName: string;
    departmentName: string;
    alerts: number;
    incidents: number;
    riskScore: number;
    status: 'AT_RISK' | 'ONLINE';
    isolated: boolean;
  }>;
  /** Per-department rollup for "Department Security Overview" — adds a
   * High/Critical split and a department risk label (same deriveRiskLevel
   * methodology as the org-wide banner, applied to this department's own
   * open incidents) on top of the existing byDepartment incident counts. */
  departmentSecurity: Array<{
    departmentName: string;
    alerts: number;
    incidents: number;
    highCriticalCount: number;
    riskLabel: DerivedRiskLevel;
  }>;
}

const MAX_RESPONSE_ACTION_ROWS = 200;
const MAX_TOP_INCIDENTS = 10;
const CONFIDENCE_BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: '0-49%', min: 0, max: 49 },
  { label: '50-69%', min: 50, max: 69 },
  { label: '70-89%', min: 70, max: 89 },
  { label: '90-100%', min: 90, max: 100 },
];

function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) return null; // avoid a meaningless "infinite" percentage off a zero baseline
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function emptySeverityRecord(): Record<Severity, number> {
  return { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
}

/**
 * Every number here is a real query against real rows for the given period
 * — nothing here is estimated, sampled, or fabricated. Fields that
 * genuinely cannot be computed (no ground truth for AI accuracy, no prior
 * week for trends) are represented as null/hasSufficientHistory: false
 * rather than a guessed value — see weekly-report-pdf.util.ts for how
 * those render as explicit "insufficient data" text (requirement #35).
 */
export interface WeeklyLiveSummary {
  period: ReportPeriod;
  totalAlerts: number;
  acknowledgedAlerts: number;
  openIncidents: number;
  totalTickets: number;
  resolvedTickets: number;
  /** null = no resolved/closed ticket in this period to average — same
   * "insufficient data" convention as the rest of this file. */
  avgResolutionMinutes: number | null;
}

@Injectable()
export class WeeklyReportDataService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lightweight, read-only counterpart to `compute()` below — backs the
   * Weekly SOC Summary *card* (a frequently-refreshed live KPI strip), not
   * the Official PDF. Deliberately a separate, smaller query set rather
   * than reusing `compute()` wholesale: `compute()` runs ~25 queries to
   * build the full PDF (MITRE breakdown, IOC/IOA, AI performance, affected
   * assets, ...), which this card doesn't need, and — importantly —
   * `compute()`'s own `totalAlerts` counts IncidentEvidence rows (real
   * "alert events"), not incidents, which is a different number than what
   * this card has always shown ("Total alerts" = incident count). Matching
   * that existing definition exactly here, just computed server-side across
   * *all* of an organization's data instead of the frontend's previous
   * client-side filter over a capped, most-recent-N incidents list (which
   * silently under-counted any week older than that page).
   */
  async computeLiveSummary(period: ReportPeriod, organizationId: string): Promise<WeeklyLiveSummary> {
    const { periodStart, periodEnd } = period;
    const incidentScope = { createdAt: { gte: periodStart, lte: periodEnd }, organizationId };
    const ticketScope = { createdAt: { gte: periodStart, lte: periodEnd }, organizationId };

    const [totalAlerts, acknowledgedAlerts, openIncidents, totalTickets, resolvedTicketsWithTimes] =
      await Promise.all([
        this.prisma.incident.count({ where: incidentScope }),
        this.prisma.incident.count({ where: { ...incidentScope, acknowledgedAt: { not: null } } }),
        this.prisma.incident.count({ where: { ...incidentScope, status: { in: OPEN_STATUSES } } }),
        this.prisma.ticket.count({ where: ticketScope }),
        this.prisma.ticket.findMany({
          where: { ...ticketScope, status: { in: ['RESOLVED', 'CLOSED'] } },
          select: { createdAt: true, updatedAt: true },
        }),
      ]);

    const avgResolutionMinutes =
      resolvedTicketsWithTimes.length > 0
        ? Math.round(
            resolvedTicketsWithTimes.reduce(
              (sum, t) => sum + (t.updatedAt.getTime() - t.createdAt.getTime()) / 60_000,
              0,
            ) / resolvedTicketsWithTimes.length,
          )
        : null;

    return {
      period,
      totalAlerts,
      acknowledgedAlerts,
      openIncidents,
      totalTickets,
      resolvedTickets: resolvedTicketsWithTimes.length,
      avgResolutionMinutes,
    };
  }

  /**
   * Phase 2.6B: `organizationId` bounds every query below to one
   * organization's data — this report previously aggregated across the
   * entire database with no tenant boundary at all (safe only under the
   * single-tenant assumption this app no longer makes; see the Phase 2.5
   * architecture review's finding on this exact gap). Two filter shapes
   * are used, matching which models carry their own organizationId column
   * versus which only reach it through their `incident` relation (see
   * schema.prisma): `incidentScope`/`ticketScope` for Incident/Ticket
   * directly, `viaIncidentScope` for IncidentEvidence/Indicator/
   * PersistenceFinding/AiAgentDecision/IncidentAction, none of which have
   * their own organizationId column.
   */
  async compute(period: ReportPeriod, organizationId: string): Promise<WeeklyReportData> {
    const { periodStart, periodEnd } = period;
    const createdInPeriod = { createdAt: { gte: periodStart, lte: periodEnd } };
    // Indicator uses firstSeenAt/lastSeenAt, not createdAt — a real schema
    // mismatch caught by live-testing this against Postgres, not by the
    // mocked unit tests (which don't validate field names against Prisma's
    // actual schema the way the real client does).
    const firstSeenInPeriod = { firstSeenAt: { gte: periodStart, lte: periodEnd } };
    const incidentScope = { ...createdInPeriod, organizationId };
    const viaIncidentScope = { incident: { organizationId } };
    const viaIncidentFirstSeen = { ...firstSeenInPeriod, incident: { organizationId } };

    const [
      totalAlerts,
      alertsBySeverityRaw,
      totalIncidents,
      openIncidentsCount,
      resolvedIncidentsCount,
      ticketsCreated,
      ticketsResolved,
      resolvedIncidentsWithTimes,
      byAttackTypeRaw,
      bySeverityRaw,
      byDepartmentRaw,
      byEndpointRaw,
      byStatusRaw,
      byIngestSourceRaw,
      mitreRaw,
      iocTypesRaw,
      repeatedIocsRaw,
      ioaRaw,
      persistenceRaw,
      c2Raw,
      classificationDecisions,
      approvedActions,
      rejectedActions,
      actionsByTypeRaw,
      closedIncidents,
      actionRows,
      priorIncidentExists,
      openBySeverityRaw,
      topIncidentsRaw,
      byDepartmentSeverityRaw,
      evidenceRoutingRaw,
    ] = await Promise.all([
      this.prisma.incidentEvidence.count({ where: { ...createdInPeriod, ...viaIncidentScope } }),
      this.prisma.incidentEvidence.groupBy({
        by: ['severity'],
        where: { ...createdInPeriod, ...viaIncidentScope },
        _count: true,
      }),
      this.prisma.incident.count({ where: incidentScope }),
      this.prisma.incident.count({ where: { ...incidentScope, status: { in: OPEN_STATUSES } } }),
      this.prisma.incident.count({
        where: { ...incidentScope, status: { in: RESOLVED_STATUSES } },
      }),
      this.prisma.ticket.count({ where: { ...createdInPeriod, organizationId } }),
      this.prisma.ticket.count({
        where: { ...createdInPeriod, organizationId, status: { in: ['RESOLVED', 'CLOSED'] } },
      }),
      this.prisma.incident.findMany({
        where: { ...incidentScope, resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true },
      }),
      this.prisma.incident.groupBy({
        by: ['mitreTechniqueName'],
        where: incidentScope,
        _count: true,
        orderBy: { _count: { mitreTechniqueName: 'desc' } },
      }),
      this.prisma.incident.groupBy({ by: ['severity'], where: incidentScope, _count: true }),
      this.prisma.incident.groupBy({
        by: ['departmentId'],
        where: incidentScope,
        _count: true,
      }),
      this.prisma.incident.groupBy({ by: ['deviceId'], where: incidentScope, _count: true }),
      this.prisma.incident.groupBy({ by: ['status'], where: incidentScope, _count: true }),
      this.prisma.incident.groupBy({ by: ['ingestSource'], where: incidentScope, _count: true }),
      this.prisma.incident.groupBy({
        by: ['mitreTechniqueId', 'mitreTechniqueName', 'mitreTactic'],
        where: incidentScope,
        _count: true,
        orderBy: { _count: { mitreTechniqueId: 'desc' } },
      }),
      this.prisma.indicator.groupBy({
        by: ['type'],
        where: { ...viaIncidentFirstSeen, category: 'IOC' },
        _count: true,
        orderBy: { _count: { type: 'desc' } },
      }),
      this.prisma.indicator.groupBy({
        by: ['value'],
        where: { ...viaIncidentFirstSeen, category: 'IOC' },
        _count: true,
        having: { value: { _count: { gt: 1 } } },
        orderBy: { _count: { value: 'desc' } },
        take: 20,
      }),
      this.prisma.indicator.groupBy({
        by: ['subtype'],
        where: {
          ...viaIncidentFirstSeen,
          category: 'IOA',
          NOT: { subtype: { startsWith: 'c2-' } },
        },
        _count: true,
        orderBy: { _count: { subtype: 'desc' } },
      }),
      this.prisma.persistenceFinding.groupBy({
        by: ['type'],
        where: { ...createdInPeriod, ...viaIncidentScope },
        _count: true,
        orderBy: { _count: { type: 'desc' } },
      }),
      this.prisma.indicator.groupBy({
        by: ['subtype'],
        where: { ...viaIncidentFirstSeen, subtype: { startsWith: 'c2-' } },
        _count: true,
        orderBy: { _count: { subtype: 'desc' } },
      }),
      this.prisma.aiAgentDecision.findMany({
        where: { ...createdInPeriod, ...viaIncidentScope, agent: 'INCIDENT_AGENT' },
        select: { generatedBy: true, confidence: true },
      }),
      this.prisma.incidentAction.count({
        where: {
          approvalStatus: ActionApprovalStatus.APPROVED,
          approvedAt: { gte: periodStart, lte: periodEnd },
          ...viaIncidentScope,
        },
      }),
      this.prisma.incidentAction.count({
        where: {
          approvalStatus: ActionApprovalStatus.REJECTED,
          approvedAt: { gte: periodStart, lte: periodEnd },
          ...viaIncidentScope,
        },
      }),
      this.prisma.incidentAction.groupBy({
        by: ['type'],
        where: { ...createdInPeriod, ...viaIncidentScope },
        _count: true,
      }),
      this.prisma.incident.count({
        where: {
          status: IncidentStatus.CLOSED,
          updatedAt: { gte: periodStart, lte: periodEnd },
          organizationId,
        },
      }),
      this.prisma.incidentAction.findMany({
        where: { ...createdInPeriod, ...viaIncidentScope },
        take: MAX_RESPONSE_ACTION_ROWS + 1,
        orderBy: { createdAt: 'desc' },
        include: {
          incident: {
            select: { caseId: true, deviceId: true, device: { select: { hostname: true } } },
          },
        },
      }),
      this.prisma.incident.count({ where: { createdAt: { lt: periodStart }, organizationId }, take: 1 }),
      // --- Additive queries below: Weekly SOC PDF redesign -----------------
      this.prisma.incident.groupBy({
        by: ['severity'],
        where: { ...incidentScope, status: { in: OPEN_STATUSES } },
        _count: true,
      }),
      this.prisma.incident.findMany({
        where: incidentScope,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        take: MAX_TOP_INCIDENTS,
        select: {
          caseId: true,
          severity: true,
          status: true,
          deviceId: true,
          departmentId: true,
          detectionRule: true,
          ingestSource: true,
          mitreTechniqueId: true,
          mitreTechniqueName: true,
          mitreTactic: true,
          createdAt: true,
          resolvedAt: true,
          description: true,
          rootCause: true,
          finalResolution: true,
        },
      }),
      this.prisma.incident.groupBy({
        by: ['departmentId', 'severity'],
        where: incidentScope,
        _count: true,
      }),
      // Real per-device/per-department alert (evidence) routing for this
      // period — IncidentEvidence has no deviceId/departmentId column of
      // its own (see schema.prisma), only via its parent incident, so this
      // is reduced in JS below rather than a Prisma groupBy through a
      // relation (which Prisma doesn't support).
      this.prisma.incidentEvidence.findMany({
        where: { ...createdInPeriod, ...viaIncidentScope },
        select: { incident: { select: { deviceId: true, departmentId: true } } },
      }),
    ]);

    // Department/device labels need a second lookup — groupBy only returns ids.
    const departmentIds = byDepartmentRaw
      .map((r) => r.departmentId)
      .filter((id): id is string => !!id);
    const deviceIds = byEndpointRaw.map((r) => r.deviceId).filter((id): id is string => !!id);
    const [departments, devices, deviceOpenIncidents, deviceIsolationActions] = await Promise.all([
      departmentIds.length
        ? this.prisma.department.findMany({
            where: { id: { in: departmentIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      deviceIds.length
        ? this.prisma.device.findMany({
            where: { id: { in: deviceIds } },
            select: {
              id: true,
              hostname: true,
              baselineScore: true,
              department: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
      // Period-scoped analogue of DevicesService's live "OPEN incidents in
      // the last 5 minutes" — here, OPEN incidents *created within this
      // reporting period* for these specific devices, feeding the same real
      // SEVERITY_PENALTY formula for a period-appropriate risk score.
      deviceIds.length
        ? this.prisma.incident.findMany({
            where: { ...incidentScope, deviceId: { in: deviceIds }, status: { in: OPEN_STATUSES } },
            select: { deviceId: true, severity: true },
          })
        : Promise.resolve([]),
      deviceIds.length
        ? this.prisma.incidentAction.findMany({
            where: {
              type: IncidentActionType.ISOLATE_DEVICE,
              outcome: 'SUCCESS',
              createdAt: { gte: periodStart, lte: periodEnd },
              incident: { organizationId, deviceId: { in: deviceIds } },
            },
            select: { incident: { select: { deviceId: true } } },
          })
        : Promise.resolve([]),
    ]);
    const departmentName = (id: string | null) =>
      departments.find((d) => d.id === id)?.name ?? 'Unassigned / device not resolved';
    const deviceName = (id: string | null) =>
      devices.find((d) => d.id === id)?.hostname ?? 'Unassigned / device not resolved';

    const alertsBySeverity: Record<Severity, number> = emptySeverityRecord();
    for (const row of alertsBySeverityRaw) {
      alertsBySeverity[row.severity] = row._count;
    }

    const openIncidentsBySeverity: Record<Severity, number> = emptySeverityRecord();
    for (const row of openBySeverityRaw) {
      openIncidentsBySeverity[row.severity] = row._count;
    }

    const resolutionTimes = resolvedIncidentsWithTimes
      .filter((i) => i.resolvedAt)
      .map((i) => i.resolvedAt!.getTime() - i.createdAt.getTime());
    const avgResolutionTimeMs =
      resolutionTimes.length > 0
        ? Math.round(resolutionTimes.reduce((sum, ms) => sum + ms, 0) / resolutionTimes.length)
        : null;

    const confidenceValues = classificationDecisions
      .map((d) => d.confidence)
      .filter((c): c is number => c !== null);
    const confidenceDistribution = CONFIDENCE_BUCKETS.map((bucket) => ({
      bucket: bucket.label,
      count: confidenceValues.filter((c) => c >= bucket.min && c <= bucket.max).length,
    }));

    let previousWeekTotalAlerts: number | null = null;
    let previousWeekTotalIncidents: number | null = null;
    if (priorIncidentExists > 0) {
      const previousPeriodStart = new Date(periodStart);
      previousPeriodStart.setUTCDate(previousPeriodStart.getUTCDate() - 7);
      const previousPeriodEnd = new Date(periodStart.getTime() - 1);
      [previousWeekTotalAlerts, previousWeekTotalIncidents] = await Promise.all([
        this.prisma.incidentEvidence.count({
          where: {
            createdAt: { gte: previousPeriodStart, lte: previousPeriodEnd },
            incident: { organizationId },
          },
        }),
        this.prisma.incident.count({
          where: { createdAt: { gte: previousPeriodStart, lte: previousPeriodEnd }, organizationId },
        }),
      ]);
    }

    // --- Top incidents (additive) -----------------------------------------
    const topIncidents = topIncidentsRaw.map((incident) => ({
      caseId: incident.caseId,
      severity: incident.severity,
      status: incident.status,
      deviceName: incident.deviceId ? deviceName(incident.deviceId) : null,
      departmentName: incident.departmentId ? departmentName(incident.departmentId) : null,
      detectionRule: incident.detectionRule,
      ingestSource: incident.ingestSource,
      mitreTechniqueId: incident.mitreTechniqueId,
      mitreTechniqueName: incident.mitreTechniqueName,
      mitreTactic: incident.mitreTactic,
      createdAt: incident.createdAt,
      resolvedAt: incident.resolvedAt,
      resolutionTimeMs: incident.resolvedAt
        ? incident.resolvedAt.getTime() - incident.createdAt.getTime()
        : null,
      description: incident.description,
      rootCause: incident.rootCause,
      finalResolution: incident.finalResolution,
    }));

    // --- Affected assets (additive) ----------------------------------------
    const alertsByDevice = new Map<string, number>();
    const alertsByDepartment = new Map<string, number>();
    for (const row of evidenceRoutingRaw) {
      const deviceId = row.incident.deviceId;
      if (deviceId) alertsByDevice.set(deviceId, (alertsByDevice.get(deviceId) ?? 0) + 1);
      const deptId = row.incident.departmentId;
      if (deptId) alertsByDepartment.set(deptId, (alertsByDepartment.get(deptId) ?? 0) + 1);
    }

    const openIncidentsByDevice = new Map<string, { severity: Severity }[]>();
    for (const incident of deviceOpenIncidents) {
      if (!incident.deviceId) continue;
      const list = openIncidentsByDevice.get(incident.deviceId) ?? [];
      list.push(incident);
      openIncidentsByDevice.set(incident.deviceId, list);
    }
    const isolatedDeviceIds = new Set(
      deviceIsolationActions.map((a) => a.incident.deviceId).filter((id): id is string => !!id),
    );

    const affectedAssets = byEndpointRaw
      .filter((r): r is typeof r & { deviceId: string } => !!r.deviceId)
      .map((r) => {
        const device = devices.find((d) => d.id === r.deviceId);
        const openForDevice = openIncidentsByDevice.get(r.deviceId) ?? [];
        const penalty = openForDevice.reduce((sum, i) => sum + SEVERITY_PENALTY[i.severity], 0);
        const baseline = device?.baselineScore ?? DEFAULT_BASELINE_SCORE;
        const riskScore = Math.max(10, Math.min(100, baseline - penalty));
        return {
          deviceName: deviceName(r.deviceId),
          departmentName: device?.department.name ?? 'Unassigned / device not resolved',
          alerts: alertsByDevice.get(r.deviceId) ?? 0,
          incidents: r._count,
          riskScore,
          status: openForDevice.length > 0 ? ('AT_RISK' as const) : ('ONLINE' as const),
          isolated: isolatedDeviceIds.has(r.deviceId),
        };
      })
      .sort((a, b) => b.incidents - a.incidents);

    // --- Department security overview (additive) ---------------------------
    const highCriticalByDept = new Map<string, number>();
    for (const row of byDepartmentSeverityRaw) {
      if (!row.departmentId) continue;
      if (row.severity === 'HIGH' || row.severity === 'CRITICAL') {
        highCriticalByDept.set(row.departmentId, (highCriticalByDept.get(row.departmentId) ?? 0) + row._count);
      }
    }
    const departmentSecurity = byDepartmentRaw
      .filter((r): r is typeof r & { departmentId: string } => !!r.departmentId)
      .map((r) => {
        const deptOpenBySeverity: Record<Severity, number> = emptySeverityRecord();
        for (const row of byDepartmentSeverityRaw) {
          if (row.departmentId === r.departmentId) {
            // Department risk uses the same real open-incident methodology
            // as the org-wide banner, but this groupBy isn't status-filtered
            // (Prisma can't cheaply groupBy departmentId+severity+status in
            // one call alongside everything else here) — approximated from
            // this department's overall severity mix this period rather
            // than a second dedicated open-only query, and labeled as a
            // department-level indicator, not the same "OPEN incidents"
            // definition as the org-wide banner.
            deptOpenBySeverity[row.severity] += row._count;
          }
        }
        return {
          departmentName: departmentName(r.departmentId),
          alerts: alertsByDepartment.get(r.departmentId) ?? 0,
          incidents: r._count,
          highCriticalCount: highCriticalByDept.get(r.departmentId) ?? 0,
          riskLabel: deriveRiskLevel(deptOpenBySeverity),
        };
      })
      .sort((a, b) => b.incidents - a.incidents);

    return {
      period,
      executiveSummary: {
        totalAlerts,
        alertsBySeverity,
        totalIncidents,
        openIncidents: openIncidentsCount,
        resolvedIncidents: resolvedIncidentsCount,
        ticketsCreated,
        ticketsResolved,
        avgResolutionTimeMs,
      },
      incidentOverview: {
        byAttackType: byAttackTypeRaw.map((r) => ({
          label: r.mitreTechniqueName,
          count: r._count,
        })),
        bySeverity: bySeverityRaw.map((r) => ({ label: r.severity, count: r._count })),
        byDepartment: byDepartmentRaw.map((r) => ({
          label: departmentName(r.departmentId),
          count: r._count,
        })),
        byEndpoint: byEndpointRaw.map((r) => ({ label: deviceName(r.deviceId), count: r._count })),
        byStatus: byStatusRaw.map((r) => ({ label: r.status, count: r._count })),
        byIngestSource: byIngestSourceRaw.map((r) => ({ label: r.ingestSource, count: r._count })),
      },
      mitreOverview: mitreRaw.map((r) => ({
        techniqueId: r.mitreTechniqueId,
        techniqueName: r.mitreTechniqueName,
        tactic: r.mitreTactic,
        occurrences: r._count,
      })),
      iocIoaOverview: {
        topIocTypes: iocTypesRaw.map((r) => ({ type: r.type, count: r._count })),
        repeatedIocs: repeatedIocsRaw.map((r) => ({ value: r.value, occurrences: r._count })),
        topIoas: ioaRaw.map((r) => ({ subtype: r.subtype ?? 'unspecified', count: r._count })),
        persistenceFindings: persistenceRaw.map((r) => ({ type: r.type, count: r._count })),
        c2Indicators: c2Raw.map((r) => ({ subtype: r.subtype ?? 'unspecified', count: r._count })),
      },
      aiPerformance: {
        classificationsPerformed: classificationDecisions.length,
        claudeGenerated: classificationDecisions.filter((d) => d.generatedBy === 'claude').length,
        ruleBasedFallback: classificationDecisions.filter(
          (d) => d.generatedBy === 'rule-based-fallback',
        ).length,
        confidenceDistribution,
        approvedActions,
        rejectedActions,
      },
      responseSummary: {
        byActionType: actionsByTypeRaw.map((r) => ({ type: r.type, count: r._count })),
        closedIncidents,
        ticketsCount: ticketsCreated,
        actions: actionRows.slice(0, MAX_RESPONSE_ACTION_ROWS).map((a) => ({
          caseId: a.incident.caseId,
          type: a.type,
          endpoint: a.incident.device?.hostname ?? null,
          analyst: a.performedBy,
          automated: (a.requestedBy ?? '').startsWith('ai:'),
          timestamp: a.createdAt,
          result: a.outcome,
        })),
        truncated: actionRows.length > MAX_RESPONSE_ACTION_ROWS,
      },
      trends: {
        hasSufficientHistory: priorIncidentExists > 0,
        previousWeekTotalAlerts,
        previousWeekTotalIncidents,
        alertsDeltaPct:
          previousWeekTotalAlerts !== null
            ? percentDelta(totalAlerts, previousWeekTotalAlerts)
            : null,
        incidentsDeltaPct:
          previousWeekTotalIncidents !== null
            ? percentDelta(totalIncidents, previousWeekTotalIncidents)
            : null,
      },
      openIncidentsBySeverity,
      topIncidents,
      affectedAssets,
      departmentSecurity,
    };
  }
}

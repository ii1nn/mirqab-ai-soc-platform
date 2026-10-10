import { Test } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma/prisma.service';
import { deriveRiskLevel, WeeklyReportDataService } from './weekly-report-data.service';
import { weekBounds } from './weekly-report-period.util';

/** Dispatches on the Prisma call's `by`/`where`/`select` shape rather than
 * call order, so this test doesn't silently stop covering what it claims to
 * cover if WeeklyReportDataService's Promise.all array gets reordered.
 * Order matters below: more specific branches (exact `by` combinations,
 * `where.status` presence) are checked before the more general
 * single-field ones they'd otherwise also match. */
function buildPrismaMock() {
  const groupByHasField = (args: { by?: string[] }, field: string) => args.by?.includes(field);
  const groupByIsExactly = (args: { by?: string[] }, fields: string[]) =>
    args.by?.length === fields.length && fields.every((f) => args.by?.includes(f));

  return {
    incidentEvidence: {
      count: jest.fn().mockResolvedValue(42),
      groupBy: jest.fn().mockResolvedValue([
        { severity: 'HIGH', _count: 30 },
        { severity: 'LOW', _count: 12 },
      ]),
      findMany: jest.fn().mockResolvedValue([
        { incident: { deviceId: 'device-1', departmentId: 'dept-1' } },
        { incident: { deviceId: 'device-1', departmentId: 'dept-1' } },
      ]),
    },
    incident: {
      count: jest.fn((args: { where?: { status?: unknown; createdAt?: { lt?: Date } } }) => {
        if (args?.where?.createdAt?.lt) return Promise.resolve(5); // priorIncidentExists
        if (args?.where?.status) return Promise.resolve(1); // open/resolved/closed counts
        return Promise.resolve(10); // totalIncidents
      }),
      groupBy: jest.fn(
        (args: {
          by: string[];
          where?: { status?: unknown; departmentId?: unknown };
        }) => {
          if (groupByIsExactly(args, ['departmentId', 'severity'])) {
            return Promise.resolve([
              { departmentId: 'dept-1', severity: 'HIGH', _count: 2 },
              { departmentId: 'dept-1', severity: 'CRITICAL', _count: 1 },
              { departmentId: 'dept-1', severity: 'LOW', _count: 1 },
            ]);
          }
          if (groupByIsExactly(args, ['severity']) && args.where?.status) {
            // openBySeverityRaw — real OPEN-status incidents this period.
            return Promise.resolve([{ severity: 'CRITICAL', _count: 1 }]);
          }
          if (groupByHasField(args, 'mitreTechniqueId')) {
            return Promise.resolve([
              {
                mitreTechniqueId: 'T1486',
                mitreTechniqueName: 'Data Encrypted for Impact',
                mitreTactic: 'Impact',
                _count: 6,
              },
            ]);
          }
          if (groupByHasField(args, 'mitreTechniqueName')) {
            return Promise.resolve([{ mitreTechniqueName: 'Data Encrypted for Impact', _count: 6 }]);
          }
          if (groupByHasField(args, 'departmentId')) {
            return Promise.resolve([{ departmentId: 'dept-1', _count: 4 }]);
          }
          if (groupByHasField(args, 'deviceId')) {
            return Promise.resolve([{ deviceId: 'device-1', _count: 3 }]);
          }
          if (groupByHasField(args, 'status')) {
            return Promise.resolve([{ status: 'OPEN', _count: 7 }]);
          }
          if (groupByHasField(args, 'severity')) {
            return Promise.resolve([{ severity: 'HIGH', _count: 6 }]);
          }
          if (groupByHasField(args, 'ingestSource')) {
            return Promise.resolve([
              { ingestSource: 'OPEN_SOURCE_DATASET', _count: 4 },
              { ingestSource: 'SIMULATION', _count: 3 },
            ]);
          }
          return Promise.resolve([]);
        },
      ),
      findMany: jest.fn(
        (args: { select?: { severity?: boolean; deviceId?: boolean; caseId?: boolean; createdAt?: boolean; resolvedAt?: boolean } }) => {
          if (args.select?.caseId) {
            // topIncidentsRaw
            return Promise.resolve([
              {
                caseId: 'INC-20260810-0001',
                severity: 'CRITICAL',
                status: 'OPEN',
                deviceId: 'device-1',
                departmentId: 'dept-1',
                detectionRule: 'sigma-ransomware-behavior',
                ingestSource: 'OPEN_SOURCE_DATASET',
                mitreTechniqueId: 'T1486',
                mitreTechniqueName: 'Data Encrypted for Impact',
                mitreTactic: 'Impact',
                createdAt: new Date('2026-08-10T00:00:00Z'),
                resolvedAt: null,
                description: 'Ransomware-like file encryption activity detected.',
                rootCause: null,
                finalResolution: null,
              },
            ]);
          }
          if (args.select?.deviceId && args.select?.severity && !args.select?.caseId) {
            // deviceOpenIncidents
            return Promise.resolve([{ deviceId: 'device-1', severity: 'CRITICAL' }]);
          }
          // resolvedIncidentsWithTimes
          return Promise.resolve([
            {
              createdAt: new Date('2026-08-10T00:00:00Z'),
              resolvedAt: new Date('2026-08-10T02:00:00Z'),
            },
            {
              createdAt: new Date('2026-08-11T00:00:00Z'),
              resolvedAt: new Date('2026-08-11T04:00:00Z'),
            },
          ]);
        },
      ),
    },
    ticket: {
      count: jest.fn().mockResolvedValue(2),
    },
    indicator: {
      groupBy: jest.fn(
        (args: { by: string[]; where?: { subtype?: unknown; category?: string } }) => {
          if (
            args.where?.subtype &&
            typeof args.where.subtype === 'object' &&
            'startsWith' in (args.where.subtype as object)
          ) {
            return Promise.resolve([{ subtype: 'c2-framework', _count: 2 }]);
          }
          if (args.where?.category === 'IOA') {
            return Promise.resolve([{ subtype: 'credential-dumping', _count: 3 }]);
          }
          if (groupByHasField(args, 'value')) {
            return Promise.resolve([{ value: 'hash:abc123', _count: 3 }]);
          }
          return Promise.resolve([{ type: 'HASH', _count: 5 }]);
        },
      ),
    },
    persistenceFinding: {
      groupBy: jest.fn().mockResolvedValue([{ type: 'SCHEDULED_TASK', _count: 2 }]),
    },
    aiAgentDecision: {
      findMany: jest.fn().mockResolvedValue([
        { generatedBy: 'claude', confidence: null },
        { generatedBy: 'rule-based-fallback', confidence: 45 },
        { generatedBy: 'rule-based-fallback', confidence: 95 },
      ]),
    },
    incidentAction: {
      count: jest.fn((args: { where?: { approvalStatus?: string } }) =>
        Promise.resolve(args?.where?.approvalStatus === 'APPROVED' ? 4 : 1),
      ),
      groupBy: jest.fn().mockResolvedValue([{ type: 'ISOLATE_DEVICE', _count: 3 }]),
      // Shared by both the response-action-detail query and the
      // period-scoped device-isolation lookup — both real shapes carry
      // `incident.deviceId`, so the same fixture row satisfies both.
      findMany: jest.fn().mockResolvedValue([
        {
          type: 'ISOLATE_DEVICE',
          outcome: 'SUCCESS',
          performedBy: 'analyst@mirqab.local',
          requestedBy: 'ai:recommendation-agent',
          createdAt: new Date('2026-08-10T10:00:00Z'),
          incident: {
            caseId: 'INC-20260810-0001',
            deviceId: 'device-1',
            device: { hostname: 'FIN-WKS-01' },
          },
        },
      ]),
    },
    department: { findMany: jest.fn().mockResolvedValue([{ id: 'dept-1', name: 'Finance' }]) },
    device: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'device-1', hostname: 'FIN-WKS-01', baselineScore: 85, department: { name: 'Finance' } },
      ]),
    },
  };
}

describe('WeeklyReportDataService', () => {
  let service: WeeklyReportDataService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  const period = weekBounds(new Date('2026-08-12T00:00:00Z'));

  beforeEach(async () => {
    prisma = buildPrismaMock();
    const moduleRef = await Test.createTestingModule({
      providers: [WeeklyReportDataService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(WeeklyReportDataService);
  });

  it('computes real executive summary counts and severity breakdown', async () => {
    const data = await service.compute(period, 'org-1');

    expect(data.executiveSummary.totalAlerts).toBe(42);
    expect(data.executiveSummary.alertsBySeverity.HIGH).toBe(30);
    expect(data.executiveSummary.alertsBySeverity.LOW).toBe(12);
    expect(data.executiveSummary.alertsBySeverity.CRITICAL).toBe(0); // never fabricated — zero when no rows
    expect(data.executiveSummary.totalIncidents).toBe(10);
  });

  it('averages real resolution times rather than reporting a fabricated number', async () => {
    const data = await service.compute(period, 'org-1');
    // (2h + 4h) / 2 = 3h = 10,800,000ms
    expect(data.executiveSummary.avgResolutionTimeMs).toBe(3 * 60 * 60 * 1000);
  });

  it('reports avgResolutionTimeMs as null (insufficient data) when nothing resolved this period', async () => {
    prisma.incident.findMany.mockResolvedValue([]);
    const data = await service.compute(period, 'org-1');
    expect(data.executiveSummary.avgResolutionTimeMs).toBeNull();
  });

  it('buckets AI classification confidence into real ranges', async () => {
    const data = await service.compute(period, 'org-1');
    const bucket90 = data.aiPerformance.confidenceDistribution.find((b) => b.bucket === '90-100%');
    const bucket40 = data.aiPerformance.confidenceDistribution.find((b) => b.bucket === '0-49%');
    expect(bucket90?.count).toBe(1);
    expect(bucket40?.count).toBe(1);
    expect(data.aiPerformance.claudeGenerated).toBe(1);
    expect(data.aiPerformance.ruleBasedFallback).toBe(2);
  });

  it('reports trends as insufficient history when no prior incident exists at all', async () => {
    prisma.incident.count.mockImplementation((args: { where?: { createdAt?: { lt?: Date } } }) =>
      Promise.resolve(args?.where?.createdAt?.lt ? 0 : 10),
    );
    const data = await service.compute(period, 'org-1');
    expect(data.trends.hasSufficientHistory).toBe(false);
    expect(data.trends.alertsDeltaPct).toBeNull();
  });

  it('computes a real trend delta when prior-week history exists', async () => {
    const data = await service.compute(period, 'org-1');
    expect(data.trends.hasSufficientHistory).toBe(true);
    expect(data.trends.previousWeekTotalAlerts).toBe(42); // mocked incidentEvidence.count always returns 42
    expect(data.trends.alertsDeltaPct).toBe(0); // same value both weeks in this mock -> 0% change
  });

  it('resolves department/device labels for the incident overview groupings', async () => {
    const data = await service.compute(period, 'org-1');
    expect(data.incidentOverview.byDepartment[0].label).toBe('Finance');
    expect(data.incidentOverview.byEndpoint[0].label).toBe('FIN-WKS-01');
  });

  it('breaks incidents down by real ingest provenance, keeping dataset/simulation traffic distinguishable', async () => {
    const data = await service.compute(period, 'org-1');
    expect(data.incidentOverview.byIngestSource).toEqual([
      { label: 'OPEN_SOURCE_DATASET', count: 4 },
      { label: 'SIMULATION', count: 3 },
    ]);
  });

  it('includes real Case IDs and analysts in the response action detail rows', async () => {
    const data = await service.compute(period, 'org-1');
    expect(data.responseSummary.actions[0]).toMatchObject({
      caseId: 'INC-20260810-0001',
      endpoint: 'FIN-WKS-01',
      analyst: 'analyst@mirqab.local',
      automated: true,
    });
  });

  /** Phase 2.6B: every top-level Incident/Ticket aggregate query must be
   * bounded to the caller's organization — this report previously
   * aggregated across the entire database with no tenant boundary. */
  it("scopes the core incident/ticket aggregates to the caller's organization", async () => {
    await service.compute(period, 'org-42');

    expect(prisma.incident.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-42' }) }),
    );
    expect(prisma.ticket.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-42' }) }),
    );
    expect(prisma.incidentEvidence.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ incident: { organizationId: 'org-42' } }),
      }),
    );
  });

  // --- Weekly SOC PDF redesign: additive fields ----------------------------

  describe('deriveRiskLevel', () => {
    it('returns CRITICAL when any OPEN critical incident exists', () => {
      expect(deriveRiskLevel({ LOW: 0, MEDIUM: 0, HIGH: 5, CRITICAL: 1 })).toBe('CRITICAL');
    });
    it('returns HIGH when an OPEN high incident exists but no critical one', () => {
      expect(deriveRiskLevel({ LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 0 })).toBe('HIGH');
    });
    it('returns HIGH when there are 3+ OPEN incidents of any severity, even without a HIGH/CRITICAL one', () => {
      expect(deriveRiskLevel({ LOW: 3, MEDIUM: 0, HIGH: 0, CRITICAL: 0 })).toBe('HIGH');
    });
    it('returns MEDIUM when 1-2 OPEN low/medium incidents exist', () => {
      expect(deriveRiskLevel({ LOW: 1, MEDIUM: 1, HIGH: 0, CRITICAL: 0 })).toBe('MEDIUM');
    });
    it('returns LOW when there are no OPEN incidents at all', () => {
      expect(deriveRiskLevel({ LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 })).toBe('LOW');
    });
  });

  it('computes the real open-incident severity breakdown used to derive Overall Security Risk', async () => {
    const data = await service.compute(period, 'org-1');
    expect(data.openIncidentsBySeverity).toEqual({ LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 1 });
  });

  it('returns real top-incident rows with resolved rootCause/finalResolution left null rather than fabricated', async () => {
    const data = await service.compute(period, 'org-1');
    expect(data.topIncidents).toHaveLength(1);
    expect(data.topIncidents[0]).toMatchObject({
      caseId: 'INC-20260810-0001',
      severity: 'CRITICAL',
      deviceName: 'FIN-WKS-01',
      departmentName: 'Finance',
      rootCause: null,
      finalResolution: null,
    });
  });

  it('computes real per-asset rollups including a period-scoped risk score and isolation state', async () => {
    const data = await service.compute(period, 'org-1');
    expect(data.affectedAssets).toHaveLength(1);
    const asset = data.affectedAssets[0];
    expect(asset.deviceName).toBe('FIN-WKS-01');
    expect(asset.departmentName).toBe('Finance');
    expect(asset.alerts).toBe(2); // from incidentEvidence.findMany fixture
    expect(asset.incidents).toBe(3); // from byEndpointRaw fixture
    // baseline 85 - CRITICAL penalty 30 (one real OPEN critical incident this period) = 55
    expect(asset.riskScore).toBe(55);
    expect(asset.status).toBe('AT_RISK');
    expect(asset.isolated).toBe(true);
  });

  it('computes a real department security rollup with a High/Critical split and derived risk label', async () => {
    const data = await service.compute(period, 'org-1');
    expect(data.departmentSecurity).toHaveLength(1);
    const dept = data.departmentSecurity[0];
    expect(dept.departmentName).toBe('Finance');
    expect(dept.alerts).toBe(2);
    expect(dept.incidents).toBe(4); // from byDepartmentRaw fixture
    expect(dept.highCriticalCount).toBe(3); // 2 HIGH + 1 CRITICAL from the departmentId+severity fixture
    expect(dept.riskLabel).toBe('CRITICAL'); // that department's own severity mix includes a CRITICAL row
  });
});

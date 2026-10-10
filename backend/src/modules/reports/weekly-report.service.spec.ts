import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { WeeklyReportDataService } from './weekly-report-data.service';
import { WeeklyReportService } from './weekly-report.service';
import { previousCompletedWeek } from './weekly-report-period.util';

// Computed from the real "now", same as the service itself does internally
// (WeeklyReportService.generatePreviousWeek calls previousCompletedWeek(new
// Date())) — a fixed hardcoded date here would silently drift out of sync
// with "the previous completed week" as calendar time passes, an
// unrelated pre-existing flake this fix removes rather than papering over.
const MINIMAL_DATA = {
  period: previousCompletedWeek(new Date()),
  executiveSummary: {
    totalAlerts: 0,
    alertsBySeverity: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
    totalIncidents: 0,
    openIncidents: 0,
    resolvedIncidents: 0,
    ticketsCreated: 0,
    ticketsResolved: 0,
    avgResolutionTimeMs: null,
  },
  incidentOverview: {
    byAttackType: [],
    bySeverity: [],
    byDepartment: [],
    byEndpoint: [],
    byStatus: [],
    byIngestSource: [],
  },
  mitreOverview: [],
  iocIoaOverview: {
    topIocTypes: [],
    repeatedIocs: [],
    topIoas: [],
    persistenceFindings: [],
    c2Indicators: [],
  },
  aiPerformance: {
    classificationsPerformed: 0,
    claudeGenerated: 0,
    ruleBasedFallback: 0,
    confidenceDistribution: [],
    approvedActions: 0,
    rejectedActions: 0,
  },
  responseSummary: {
    byActionType: [],
    closedIncidents: 0,
    ticketsCount: 0,
    actions: [],
    truncated: false,
  },
  trends: {
    hasSufficientHistory: false,
    previousWeekTotalAlerts: null,
    previousWeekTotalIncidents: null,
    alertsDeltaPct: null,
    incidentsDeltaPct: null,
  },
  openIncidentsBySeverity: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
  topIncidents: [],
  affectedAssets: [],
  departmentSecurity: [],
};

describe('WeeklyReportService', () => {
  let service: WeeklyReportService;
  let prisma: {
    weeklyReport: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let dataService: { compute: jest.Mock };

  beforeEach(async () => {
    prisma = {
      weeklyReport: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }) => ({ id: 'report-1', ...data })),
        update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
    };
    dataService = { compute: jest.fn().mockResolvedValue(MINIMAL_DATA) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WeeklyReportService,
        { provide: PrismaService, useValue: prisma },
        { provide: WeeklyReportDataService, useValue: dataService },
      ],
    }).compile();

    service = moduleRef.get(WeeklyReportService);
  });

  it('generates a report for the previous completed week, scoped to the caller organization', async () => {
    const result = await service.generatePreviousWeek('analyst@mirqab.local', 'org-1');

    expect(dataService.compute).toHaveBeenCalledWith(expect.anything(), 'org-1');
    expect(prisma.weeklyReport.create).toHaveBeenCalledTimes(1);
    expect(prisma.weeklyReport.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-1' }) }),
    );
    expect(result.filename).toMatch(
      /^MIRQAB_Weekly_SOC_Report_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.pdf$/,
    );
  });

  it('regenerating a week for the same organization updates the existing row rather than duplicating', async () => {
    prisma.weeklyReport.findFirst.mockResolvedValue({ id: 'existing-report' });
    await service.generatePreviousWeek('analyst@mirqab.local', 'org-1');

    expect(prisma.weeklyReport.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-1' }),
      }),
    );
    expect(prisma.weeklyReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-report' },
        data: expect.objectContaining({ generatedBy: 'analyst@mirqab.local' }),
      }),
    );
    expect(prisma.weeklyReport.create).not.toHaveBeenCalled();
  });

  /** Phase 2.6B — cross-organization isolation: Organization B regenerating
   * a report for a week Organization A already has must never touch A's
   * row, even though both share the same (periodStart, periodEnd). */
  it('does not find/update another organization\'s report for the same period', async () => {
    // findFirst is itself organization-scoped — a real DB would only
    // return org-B's own row (or null), never org-A's, even for the exact
    // same period.
    prisma.weeklyReport.findFirst.mockResolvedValue(null);
    await service.generatePreviousWeek('analyst@org-b.local', 'org-B');

    expect(prisma.weeklyReport.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-B' }) }),
    );
    expect(prisma.weeklyReport.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-B' }) }),
    );
  });

  /** The (periodStart, periodEnd) DB unique constraint isn't
   * organization-aware yet (documented, deferred limitation — see
   * WeeklyReportService's own class comment) — a genuine cross-org
   * constraint collision on `create` must surface as a clear error, not a
   * raw 500. */
  it('surfaces a clear ConflictException when the underlying (period) unique constraint is violated by a different organization', async () => {
    prisma.weeklyReport.findFirst.mockResolvedValue(null);
    prisma.weeklyReport.create.mockRejectedValue(new Error('Unique constraint failed'));

    await expect(service.generatePreviousWeek('analyst@org-b.local', 'org-B')).rejects.toThrow(
      ConflictException,
    );
  });

  it('generates for an explicit week when weekStart is given', async () => {
    await service.generateForWeekContaining(
      new Date('2026-08-05T00:00:00Z'),
      'analyst@mirqab.local',
      'org-1',
    );
    expect(dataService.compute).toHaveBeenCalledWith(
      expect.objectContaining({ periodStart: expect.any(Date), periodEnd: expect.any(Date) }),
      'org-1',
    );
  });

  it("lists report history filtered by period, scoped to the caller's organization", async () => {
    await service.listHistory('org-1', { from: new Date('2026-08-01T00:00:00Z') });
    expect(prisma.weeklyReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', periodStart: { gte: new Date('2026-08-01T00:00:00Z') } },
      }),
    );
  });

  it('throws NotFoundException when downloading a report that does not exist', async () => {
    prisma.weeklyReport.findUnique.mockResolvedValue(null);
    await expect(service.getPdf('missing-id', 'org-1')).rejects.toThrow(NotFoundException);
  });

  /** Phase 2.6B — cross-organization IDOR/BOLA: a report id alone must not
   * be sufficient to download another organization's report. */
  it("throws NotFoundException (not the report) when the report belongs to a different organization", async () => {
    prisma.weeklyReport.findUnique.mockResolvedValue({
      id: 'report-1',
      organizationId: 'org-B',
      pdf: Buffer.from('%PDF-fake'),
      filename: 'MIRQAB_Weekly_SOC_Report_2026-08-03_to_2026-08-09.pdf',
    });
    await expect(service.getPdf('report-1', 'org-A')).rejects.toThrow(NotFoundException);
  });

  it('returns the stored PDF buffer and filename for the correct organization', async () => {
    prisma.weeklyReport.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      pdf: Buffer.from('%PDF-fake'),
      filename: 'MIRQAB_Weekly_SOC_Report_2026-08-03_to_2026-08-09.pdf',
    });
    const result = await service.getPdf('report-1', 'org-1');
    expect(result.filename).toBe('MIRQAB_Weekly_SOC_Report_2026-08-03_to_2026-08-09.pdf');
    expect(result.pdf.toString()).toBe('%PDF-fake');
  });
});

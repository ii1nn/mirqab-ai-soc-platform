import { Test } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma/prisma.service';
import { WeeklyReportScheduler } from './weekly-report.scheduler';
import { WeeklyReportService } from './weekly-report.service';

describe('WeeklyReportScheduler', () => {
  let scheduler: WeeklyReportScheduler;
  let weeklyReportService: { generatePreviousWeek: jest.Mock };
  let prisma: { organization: { findMany: jest.Mock } };

  beforeEach(async () => {
    weeklyReportService = { generatePreviousWeek: jest.fn().mockResolvedValue({ filename: 'x.pdf' }) };
    prisma = {
      organization: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'org-1', name: 'Org One' },
          { id: 'org-2', name: 'Org Two' },
        ]),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        WeeklyReportScheduler,
        { provide: WeeklyReportService, useValue: weeklyReportService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    scheduler = moduleRef.get(WeeklyReportScheduler);
  });

  /**
   * Phase 2.6B: a scheduled job has no per-request user to derive an
   * organization from — this generates one report per ACTIVE organization
   * independently, rather than guessing a single "the" organization. See
   * WeeklyReportScheduler's own class comment for the full reasoning.
   */
  it('generates a report for every active organization, as the scheduler system actor', async () => {
    await scheduler.handleWeeklyReport();

    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE' } }),
    );
    expect(weeklyReportService.generatePreviousWeek).toHaveBeenCalledTimes(2);
    expect(weeklyReportService.generatePreviousWeek).toHaveBeenCalledWith(
      'system:weekly-report-scheduler',
      'org-1',
    );
    expect(weeklyReportService.generatePreviousWeek).toHaveBeenCalledWith(
      'system:weekly-report-scheduler',
      'org-2',
    );
  });

  it('does not throw when one organization\'s report generation fails, and still generates the others', async () => {
    weeklyReportService.generatePreviousWeek
      .mockRejectedValueOnce(new Error('DB unavailable'))
      .mockResolvedValueOnce({ filename: 'org-2.pdf' });

    await expect(scheduler.handleWeeklyReport()).resolves.toBeUndefined();
    expect(weeklyReportService.generatePreviousWeek).toHaveBeenCalledTimes(2);
  });

  it('generates nothing (and does not throw) when there are no active organizations', async () => {
    prisma.organization.findMany.mockResolvedValue([]);
    await expect(scheduler.handleWeeklyReport()).resolves.toBeUndefined();
    expect(weeklyReportService.generatePreviousWeek).not.toHaveBeenCalled();
  });
});

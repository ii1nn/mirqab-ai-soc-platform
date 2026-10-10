import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrgStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { WeeklyReportService } from './weekly-report.service';

const SCHEDULER_ACTOR = 'system:weekly-report-scheduler';

/**
 * Requirement #33: "Do not generate a new SOC summary PDF every day" — this
 * is the only automatic report generation job in the app, and it runs
 * weekly, not daily. The reporting week is Sunday-Saturday (see
 * weekly-report-period.util.ts); Monday 05:00 UTC gives the correlation
 * engine's 72h window and any late-arriving Saturday-night events a few
 * hours to settle before the just-completed week gets summarized.
 *
 * Phase 2.6B: a scheduled job has no per-request authenticated user to
 * derive an organization from — a genuinely different situation from every
 * other organizationId-consuming call site in this codebase, addressed
 * here rather than worked around. Organization context is determined by
 * enumerating every ACTIVE organization and generating one report per
 * organization, independently — the natural generalization of "the weekly
 * report" to a multi-tenant world (each company gets its own summary of
 * its own data), not a guess about which single organization "the" report
 * belongs to. A failure generating one organization's report is logged and
 * does not prevent the others from being generated.
 */
@Injectable()
export class WeeklyReportScheduler {
  private readonly logger = new Logger(WeeklyReportScheduler.name);

  constructor(
    private readonly weeklyReportService: WeeklyReportService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron('0 5 * * 1', { name: 'weekly-soc-report', timeZone: 'UTC' })
  async handleWeeklyReport(): Promise<void> {
    const organizations = await this.prisma.organization.findMany({
      where: { status: OrgStatus.ACTIVE },
      select: { id: true, name: true },
    });

    for (const organization of organizations) {
      try {
        const result = await this.weeklyReportService.generatePreviousWeek(
          SCHEDULER_ACTOR,
          organization.id,
        );
        this.logger.log(
          `Generated weekly SOC report ${result.filename} for organization "${organization.name}"`,
        );
      } catch (error) {
        this.logger.error(
          `Weekly SOC report generation failed for organization "${organization.name}": ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }
  }
}

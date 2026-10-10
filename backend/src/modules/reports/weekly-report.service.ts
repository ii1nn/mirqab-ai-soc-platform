import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { WeeklyReportDataService } from './weekly-report-data.service';
import { renderWeeklyReportPdf } from './weekly-report-pdf.util';
import {
  previousCompletedWeek,
  ReportPeriod,
  weekBounds,
  weeklyReportFilename,
} from './weekly-report-period.util';

const ORG_NAME = process.env.ORG_NAME ?? 'Mirqab Security Operations';

/**
 * Requirement #33/#38: generation is an upsert keyed on (periodStart,
 * periodEnd) — "regenerate a previous week's report" replaces that week's
 * stored PDF rather than accumulating duplicates. Requirement #34-37's
 * content lives in weekly-report-data.service.ts (aggregation) and
 * weekly-report-pdf.util.ts (rendering) — this service just wires the two
 * together and persists the result.
 *
 * Phase 2.6B: every method is organization-scoped. KNOWN LIMITATION, not
 * fixed here (would require a schema change, explicitly out of scope for
 * this phase — see the phase's own final report): `WeeklyReport`'s
 * database-level uniqueness is still `@@unique([periodStart, periodEnd])`
 * only, not organization-aware, because adding organizationId to that
 * constraint requires a migration. This service can no longer use Prisma's
 * `upsert` (which needs that exact unique key) — it instead looks up an
 * existing report scoped to (period, organizationId) and creates or
 * updates by id. If a *different* organization ever generates a report for
 * the exact same calendar week, the underlying DB unique constraint would
 * still reject the second INSERT — caught explicitly below and surfaced as
 * a clear error rather than a raw constraint-violation crash. Not
 * reachable today (only one organization exists), but a real gap that
 * needs the deferred migration to fully close.
 */
@Injectable()
export class WeeklyReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataService: WeeklyReportDataService,
  ) {}

  async generateForWeekContaining(anyDayInWeek: Date, generatedBy: string, organizationId: string) {
    return this.generateForPeriod(weekBounds(anyDayInWeek), generatedBy, organizationId);
  }

  async generatePreviousWeek(generatedBy: string, organizationId: string) {
    return this.generateForPeriod(previousCompletedWeek(), generatedBy, organizationId);
  }

  /** Week Selector: live (non-persisted) summary for the Weekly SOC Summary
   * card — any day within the target week, or the current in-progress week
   * when omitted, matching this card's pre-existing default. */
  async getLiveSummary(anyDayInWeek: Date | undefined, organizationId: string) {
    const period = anyDayInWeek ? weekBounds(anyDayInWeek) : weekBounds(new Date());
    return this.dataService.computeLiveSummary(period, organizationId);
  }

  private async generateForPeriod(
    period: ReportPeriod,
    generatedBy: string,
    organizationId: string,
  ) {
    const data = await this.dataService.compute(period, organizationId);
    const filename = weeklyReportFilename(period);
    const pdf = await renderWeeklyReportPdf(data, generatedBy, ORG_NAME);

    const existing = await this.prisma.weeklyReport.findFirst({
      where: { periodStart: period.periodStart, periodEnd: period.periodEnd, organizationId },
      select: { id: true },
    });

    const report = existing
      ? await this.prisma.weeklyReport.update({
          where: { id: existing.id },
          data: { generatedAt: new Date(), generatedBy, filename, pdf },
        })
      : await this.createReport(period, generatedBy, organizationId, filename, pdf);

    return {
      id: report.id,
      filename: report.filename,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
    };
  }

  private async createReport(
    period: ReportPeriod,
    generatedBy: string,
    organizationId: string,
    filename: string,
    pdf: Buffer,
  ) {
    try {
      return await this.prisma.weeklyReport.create({
        data: {
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          generatedBy,
          organizationId,
          filename,
          pdf,
        },
      });
    } catch {
      // See this class's doc comment — the (periodStart, periodEnd) unique
      // constraint isn't organization-aware yet, so a second organization
      // generating a report for a week another organization already has
      // one for hits a real DB constraint violation. Surfaced explicitly
      // rather than as a raw 500.
      throw new ConflictException(
        'A report for this period already exists under a different organization. This is a known limitation pending a schema update.',
      );
    }
  }

  /** Phase 2.6B: organization-scoped — a company must only ever see its
   * own report history. */
  async listHistory(organizationId: string, filter: { from?: Date; to?: Date } = {}) {
    return this.prisma.weeklyReport.findMany({
      where: {
        organizationId,
        ...(filter.from ? { periodStart: { gte: filter.from } } : {}),
        ...(filter.to ? { periodEnd: { lte: filter.to } } : {}),
      },
      orderBy: { periodStart: 'desc' },
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        generatedAt: true,
        generatedBy: true,
        filename: true,
      },
    });
  }

  /** Phase 2.6B: organization-scoped — a report id alone is not sufficient
   * to cross the tenant boundary, same principle as every other
   * direct-by-id fetch in this codebase. */
  async getPdf(id: string, organizationId: string): Promise<{ pdf: Buffer; filename: string }> {
    const report = await this.prisma.weeklyReport.findUnique({ where: { id } });
    if (!report || report.organizationId !== organizationId) {
      throw new NotFoundException('Weekly report not found');
    }
    return { pdf: report.pdf, filename: report.filename };
  }

  /** Week Selector: every real Sunday-Saturday period from this
   * organization's earliest incident/ticket through the current
   * (in-progress) week, newest first — lets the UI offer any historical
   * week for browsing, not just ones that already have a generated PDF.
   * Capped at 104 weeks (~2 years) as a sane upper bound, not a data
   * filter — weeks with zero incidents/tickets are still included; the
   * summary endpoint is what honestly reports zeros for them. */
  async listAvailableWeeks(organizationId: string): Promise<ReportPeriod[]> {
    const currentWeek = weekBounds(new Date());
    const [earliestIncident, earliestTicket] = await Promise.all([
      this.prisma.incident.findFirst({
        where: { organizationId },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.ticket.findFirst({
        where: { organizationId },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);
    const candidates = [earliestIncident?.createdAt, earliestTicket?.createdAt].filter(
      (d): d is Date => !!d,
    );
    if (candidates.length === 0) return [currentWeek];

    const earliestWeekStart = weekBounds(
      candidates.reduce((min, d) => (d < min ? d : min)),
    ).periodStart;

    const MAX_WEEKS = 104;
    const weeks: ReportPeriod[] = [];
    let cursorStart = currentWeek.periodStart;
    while (cursorStart.getTime() >= earliestWeekStart.getTime() && weeks.length < MAX_WEEKS) {
      weeks.push(weekBounds(cursorStart));
      const next = new Date(cursorStart);
      next.setUTCDate(next.getUTCDate() - 7);
      cursorStart = next;
    }
    return weeks;
  }
}

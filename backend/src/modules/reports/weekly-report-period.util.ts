/**
 * Requirement #33: weekly reporting period is Sunday 00:00:00.000 UTC
 * through Saturday 23:59:59.999 UTC — all boundary math lives here so the
 * scheduler, manual-generation endpoint, and data aggregation service all
 * agree on exactly the same week.
 */

export interface ReportPeriod {
  periodStart: Date;
  periodEnd: Date;
}

function startOfWeekUtc(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  d.setUTCDate(d.getUTCDate() - day); // back up to this week's Sunday
  return d;
}

export function weekBounds(anyDayInWeek: Date): ReportPeriod {
  const periodStart = startOfWeekUtc(anyDayInWeek);
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCDate(periodEnd.getUTCDate() + 7);
  periodEnd.setUTCMilliseconds(-1); // rolls back to Saturday 23:59:59.999 of this week
  return { periodStart, periodEnd };
}

/** The most recently *completed* Sunday-Saturday week relative to `now`. */
export function previousCompletedWeek(now: Date = new Date()): ReportPeriod {
  const thisWeekStart = startOfWeekUtc(now);
  const previousWeekStart = new Date(thisWeekStart);
  previousWeekStart.setUTCDate(previousWeekStart.getUTCDate() - 7);
  return weekBounds(previousWeekStart);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "MIRQAB_Weekly_SOC_Report_2026-08-03_to_2026-08-09.pdf" — the exact naming convention from requirement #38. */
export function weeklyReportFilename(period: ReportPeriod): string {
  return `MIRQAB_Weekly_SOC_Report_${isoDate(period.periodStart)}_to_${isoDate(period.periodEnd)}.pdf`;
}

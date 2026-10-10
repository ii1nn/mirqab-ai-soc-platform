import {
  previousCompletedWeek,
  weekBounds,
  weeklyReportFilename,
} from './weekly-report-period.util';

describe('weekBounds', () => {
  it("resolves a Wednesday to that week's Sunday 00:00:00.000 UTC through Saturday 23:59:59.999 UTC", () => {
    const wednesday = new Date('2026-08-12T15:30:00.000Z'); // a Wednesday
    const { periodStart, periodEnd } = weekBounds(wednesday);

    expect(periodStart.toISOString()).toBe('2026-08-09T00:00:00.000Z'); // Sunday
    expect(periodEnd.toISOString()).toBe('2026-08-15T23:59:59.999Z'); // Saturday
  });

  it('resolves a Sunday to the week that started that same day, not the preceding or following one', () => {
    const sunday = new Date('2026-08-16T10:00:00.000Z');
    const { periodStart, periodEnd } = weekBounds(sunday);

    expect(periodStart.toISOString()).toBe('2026-08-16T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-08-22T23:59:59.999Z');
  });

  it('resolves a Sunday at midnight to itself as the start of the week', () => {
    const sunday = new Date('2026-08-09T00:00:00.000Z');
    const { periodStart } = weekBounds(sunday);
    expect(periodStart.toISOString()).toBe('2026-08-09T00:00:00.000Z');
  });

  it('resolves a Saturday to the week that started the preceding Sunday, not the next one', () => {
    const saturday = new Date('2026-08-15T18:00:00.000Z');
    const { periodStart, periodEnd } = weekBounds(saturday);

    expect(periodStart.toISOString()).toBe('2026-08-09T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-08-15T23:59:59.999Z');
  });
});

describe('Sunday-Saturday boundary inclusion (requirement: Friday and Saturday must be included)', () => {
  const wednesday = new Date('2026-08-12T15:30:00.000Z');
  const { periodStart, periodEnd } = weekBounds(wednesday);

  function isWithinPeriod(date: Date): boolean {
    return date >= periodStart && date <= periodEnd;
  }

  it('includes Sunday (the first moment of the period)', () => {
    expect(isWithinPeriod(new Date('2026-08-09T00:00:00.000Z'))).toBe(true);
  });

  it('includes Friday', () => {
    expect(isWithinPeriod(new Date('2026-08-14T12:00:00.000Z'))).toBe(true);
  });

  it('includes Saturday (the last moment of the period)', () => {
    expect(isWithinPeriod(new Date('2026-08-15T23:59:59.999Z'))).toBe(true);
  });

  it('excludes the previous Sunday (one week before this period)', () => {
    expect(isWithinPeriod(new Date('2026-08-02T00:00:00.000Z'))).toBe(false);
  });

  it('excludes the following Sunday (the start of the next period)', () => {
    expect(isWithinPeriod(new Date('2026-08-16T00:00:00.000Z'))).toBe(false);
  });
});

describe('previousCompletedWeek', () => {
  it('returns the prior Sunday-Saturday week relative to now, not the current in-progress week', () => {
    const now = new Date('2026-08-14T12:00:00.000Z'); // a Friday, mid-week
    const { periodStart, periodEnd } = previousCompletedWeek(now);

    expect(periodStart.toISOString()).toBe('2026-08-02T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-08-08T23:59:59.999Z');
  });
});

describe('weeklyReportFilename', () => {
  it('matches the exact naming convention from requirement #38', () => {
    const period = weekBounds(new Date('2026-08-05T00:00:00.000Z'));
    expect(weeklyReportFilename(period)).toBe(
      'MIRQAB_Weekly_SOC_Report_2026-08-02_to_2026-08-08.pdf',
    );
  });
});

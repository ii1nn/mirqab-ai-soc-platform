import type { ReportWeek, WeeklyReportSummary, WeeklySummary } from '../types/domain';
import { apiClient } from './api-client';
import { downloadBlob } from '../lib/download';
import type {
  BackendReportPeriod,
  BackendWeeklyReportSummary,
  BackendWeeklySummary,
} from './backend-types';

function adapt(report: BackendWeeklyReportSummary): WeeklyReportSummary {
  return { ...report };
}

function adaptSummary(summary: BackendWeeklySummary): WeeklySummary {
  return {
    periodStart: summary.period.periodStart,
    periodEnd: summary.period.periodEnd,
    totalAlerts: summary.totalAlerts,
    acknowledgedAlerts: summary.acknowledgedAlerts,
    openIncidents: summary.openIncidents,
    totalTickets: summary.totalTickets,
    resolvedTickets: summary.resolvedTickets,
    avgResolutionMinutes: summary.avgResolutionMinutes,
  };
}

function adaptWeek(week: BackendReportPeriod): ReportWeek {
  return { ...week };
}

export const reportsService = {
  /** Week Selector: live KPI summary for the Weekly SOC Summary card. Any
   * day within the target week; omit for the current in-progress week. */
  async getWeeklySummary(weekStart?: string): Promise<WeeklySummary> {
    const { data } = await apiClient.get<BackendWeeklySummary>('/reports/weekly/summary', {
      params: weekStart ? { weekStart } : undefined,
    });
    return adaptSummary(data);
  },

  /** Week Selector: every real Sunday-Saturday period with data, plus the
   * current week, newest first. */
  async listAvailableWeeks(): Promise<ReportWeek[]> {
    const { data } = await apiClient.get<BackendReportPeriod[]>('/reports/weekly/available-weeks');
    return data.map(adaptWeek);
  },

  /** Requirement #38: report history, most recent week first. */
  async listWeeklyReports(
    filter: { from?: string; to?: string } = {},
  ): Promise<WeeklyReportSummary[]> {
    const { data } = await apiClient.get<BackendWeeklyReportSummary[]>('/reports/weekly', {
      params: filter,
    });
    return data.map(adapt);
  },

  /** Generates (or, for a week that already has one, regenerates) a Weekly
   * SOC Report. Omitting weekStart targets the most recently completed week. */
  async generateWeeklyReport(weekStart?: string): Promise<WeeklyReportSummary> {
    const { data } = await apiClient.post<BackendWeeklyReportSummary>('/reports/weekly/generate', {
      weekStart,
    });
    return adapt(data);
  },

  async downloadWeeklyReport(id: string, filename: string): Promise<void> {
    const { data } = await apiClient.get<Blob>(`/reports/weekly/${id}/download`, {
      responseType: 'blob',
    });
    downloadBlob(filename, data);
  },
};

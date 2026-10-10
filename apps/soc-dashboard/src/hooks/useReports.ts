import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { reportsService } from '../services/reports.service';

/** Week Selector: live KPI summary for the Weekly SOC Summary card. Omit
 * weekStart for the current in-progress week (this card's existing
 * default). Keyed by weekStart so switching weeks never shows a stale
 * cached value from a different period under the new heading. */
export function useWeeklySummary(weekStart?: string) {
  return useQuery({
    queryKey: ['reports', 'weekly', 'summary', weekStart ?? 'current'],
    queryFn: () => reportsService.getWeeklySummary(weekStart),
  });
}

/** Week Selector: the list of selectable Sunday-Saturday periods. Rarely
 * changes within a session, so a longer staleTime avoids re-fetching it on
 * every week switch. */
export function useAvailableWeeks() {
  return useQuery({
    queryKey: ['reports', 'weekly', 'available-weeks'],
    queryFn: () => reportsService.listAvailableWeeks(),
    staleTime: 5 * 60_000,
  });
}

export function useWeeklyReports() {
  return useQuery({
    queryKey: ['reports', 'weekly'],
    queryFn: () => reportsService.listWeeklyReports(),
  });
}

/** Requirement #38: generate the most recently completed week's report, or
 * regenerate a specific past week by passing its weekStart. */
export function useGenerateWeeklyReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (weekStart?: string) => reportsService.generateWeeklyReport(weekStart),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports', 'weekly'] });
    },
  });
}

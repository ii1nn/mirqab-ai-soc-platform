import { Download, FileText, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { useIncidents } from '../../hooks/useIncidents';
import {
  useAvailableWeeks,
  useGenerateWeeklyReport,
  useWeeklyReports,
  useWeeklySummary,
} from '../../hooks/useReports';
import { useTickets } from '../../hooks/useTickets';
import { useLanguage } from '../../i18n/LanguageContext';
import { downloadJson } from '../../lib/download';
import { formatDateTime } from '../../lib/format';
import { reportsService } from '../../services/reports.service';
import { WeekSelector } from './WeekSelector';

// timeZone: 'UTC' is deliberate, not the default — the reporting period
// boundaries are defined in UTC (Sunday 00:00:00.000 through Saturday
// 23:59:59.999), so displaying them in the viewer's local timezone can
// visually spill the end date into the next calendar day (e.g. showing
// "Sep 27" for a period that ends Saturday Sep 26 UTC), which reads as
// Sunday-Sunday instead of Sunday-Saturday. Forcing UTC keeps the display
// consistent with the underlying boundary regardless of where the analyst
// viewing the dashboard is located.
function formatDateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function ReportsPage() {
  const { t } = useLanguage();
  const { data: incidents = [] } = useIncidents();
  const { data: tickets = [] } = useTickets();
  const {
    data: weeklyReports = [],
    isLoading: weeklyReportsLoading,
    isError: weeklyReportsError,
    refetch: refetchWeeklyReports,
  } = useWeeklyReports();
  const generateWeeklyReport = useGenerateWeeklyReport();
  const [weekStart, setWeekStart] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Week Selector: the selected week lives in the URL (?week=<periodStart
  // ISO>) — survives refresh and is shareable/bookmarkable, matching the
  // task's preference for a URL param over ad-hoc client state. Absent
  // param = current week, this card's existing default.
  const [searchParams, setSearchParams] = useSearchParams();
  const weekParam = searchParams.get('week');
  const { data: availableWeeks = [] } = useAvailableWeeks();
  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
    refetch: refetchSummary,
  } = useWeeklySummary(weekParam ?? undefined);
  // The list's [0] entry is always the current week (see
  // WeeklyReportService.listAvailableWeeks) — used as the selector's
  // "selected" value until the real summary for the URL's week loads, so
  // the button never renders blank on first paint.
  const selectedWeekStart = weekParam ?? availableWeeks[0]?.periodStart ?? '';

  const reports = summary
    ? [
        {
          id: 'weekly-summary',
          title: 'Weekly SOC Summary',
          description: `Alert, incident, and ticket counts computed from current backend data for ${formatDateOnly(summary.periodStart)} – ${formatDateOnly(summary.periodEnd)} (Sun–Sat).`,
          data: summary,
        },
        {
          id: 'incident-log',
          title: 'Incident Log Export',
          description: 'Full list of incidents recorded so far, with MITRE technique and department.',
          data: incidents,
        },
        {
          id: 'ticket-log',
          title: 'Ticket Log Export',
          description: 'Full list of tickets recorded so far.',
          data: tickets,
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Weekly SOC Summary</h2>
            <p className="mt-1 text-xs text-slate-400">
              {summary ? `${formatDateOnly(summary.periodStart)} – ${formatDateOnly(summary.periodEnd)}` : '—'}{' '}
              (Sunday–Saturday) · {t('reports.weekSelector.week')} counts from backend data.
            </p>
          </div>
          {availableWeeks.length > 0 && (
            <WeekSelector
              weeks={availableWeeks}
              selectedWeekStart={selectedWeekStart}
              onSelect={(weekStart) => {
                const isCurrent = weekStart === availableWeeks[0]?.periodStart;
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev);
                  if (isCurrent) next.delete('week');
                  else next.set('week', weekStart);
                  return next;
                });
              }}
            />
          )}
        </div>
        {summaryLoading ? (
          <LoadingState label={t('reports.weekSelector.loading')} />
        ) : summaryError ? (
          <ErrorState
            description={t('reports.weekSelector.errorLoading')}
            action={
              <button
                onClick={() => refetchSummary()}
                className="text-xs font-medium text-mirqab-accent hover:underline"
              >
                {t('reports.weekSelector.retry')}
              </button>
            }
          />
        ) : !summary ? null : (
          <>
            {/* Zeros are real, honest values — always rendered, never
                hidden behind an empty-state in place of the grid (that
                would misrepresent "no incidents this week" as "couldn't
                load this week"). The "no data" copy below is a
                supplementary caption for a genuinely empty week, not a
                replacement for these numbers. */}
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <Metric label="Total alerts" value={summary.totalAlerts} />
              <Metric label="Acknowledged" value={summary.acknowledgedAlerts} />
              <Metric label="Open incidents" value={summary.openIncidents} />
              <Metric label="Tickets" value={summary.totalTickets} />
              <Metric label="Resolved tickets" value={summary.resolvedTickets} />
              <Metric
                label="Avg. resolution"
                value={summary.avgResolutionMinutes !== null ? `${summary.avgResolutionMinutes}m` : '—'}
              />
            </div>
            {summary.totalAlerts === 0 && summary.totalTickets === 0 && (
              <p className="mt-3 text-xs text-slate-500">{t('reports.weekSelector.noDataForWeek')}</p>
            )}
          </>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Weekly SOC Report (Official PDF)</h2>
            <p className="mt-1 text-xs text-slate-400">
              Computed from real incident, ticket, and response data for a Sunday–Saturday period.
              Generating for a week that already has a report replaces it.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={weekStart}
              onChange={(event) => setWeekStart(event.target.value)}
              className="rounded-lg border border-white/10 bg-mirqab-primary/60 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-mirqab-accent/50"
              title="Any day within the target week — leave blank for the most recently completed week"
            />
            <Button
              variant="secondary"
              disabled={generateWeeklyReport.isPending}
              onClick={() => generateWeeklyReport.mutate(weekStart || undefined)}
            >
              <RefreshCw className="h-4 w-4" />
              {generateWeeklyReport.isPending ? 'Generating…' : 'Generate report'}
            </Button>
          </div>
        </div>

        {generateWeeklyReport.isError && (
          <p className="mb-3 text-xs text-mirqab-danger">
            Couldn't generate the report. Please try again.
          </p>
        )}

        {weeklyReportsLoading ? (
          <LoadingState label="Loading weekly reports…" />
        ) : weeklyReportsError ? (
          <ErrorState
            description="Couldn't load the weekly report list."
            action={
              <button
                onClick={() => refetchWeeklyReports()}
                className="text-xs font-medium text-mirqab-accent hover:underline"
              >
                Retry
              </button>
            }
          />
        ) : weeklyReports.length === 0 ? (
          <p className="text-xs text-slate-500">No weekly reports generated yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="pb-2 pe-4 font-medium">Period</th>
                  <th className="pb-2 pe-4 font-medium">Generated</th>
                  <th className="pb-2 pe-4 font-medium">By</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {weeklyReports.map((report) => (
                  <tr key={report.id} className="border-t border-white/5 text-slate-300">
                    <td className="py-2 pe-4">
                      {formatDateTime(report.periodStart)} – {formatDateTime(report.periodEnd)}
                    </td>
                    <td className="py-2 pe-4">{formatDateTime(report.generatedAt)}</td>
                    <td className="py-2 pe-4">{report.generatedBy}</td>
                    <td className="py-2 text-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={downloadingId === report.id}
                        onClick={async () => {
                          setDownloadingId(report.id);
                          try {
                            await reportsService.downloadWeeklyReport(report.id, report.filename);
                          } finally {
                            setDownloadingId(null);
                          }
                        }}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        {downloadingId === report.id ? 'Downloading…' : 'Download PDF'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {reports.map((report) => (
          <Card key={report.id} className="flex flex-col">
            <h3 className="text-sm font-semibold text-white">{report.title}</h3>
            <p className="mt-1 flex-1 text-xs text-slate-400">{report.description}</p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => downloadJson(`${report.id}.json`, report.data)}
            >
              <Download className="h-4 w-4" />
              Export JSON
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}

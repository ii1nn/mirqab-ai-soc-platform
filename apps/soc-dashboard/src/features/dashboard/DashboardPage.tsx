import { AnimatePresence, motion } from 'framer-motion';
import { Bell, Building2, Flame, Play, ShieldAlert, Ticket as TicketIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { IncidentInvestigationPanel } from '../../components/widgets/IncidentInvestigationPanel';
import { ThreatTopology } from '../../components/widgets/ThreatTopology';
import { SEVERITY_COLOR, SeverityBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { StatTile } from '../../components/ui/StatTile';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { useDepartments } from '../../hooks/useDepartments';
import { useDevices } from '../../hooks/useDevices';
import { useIncidents } from '../../hooks/useIncidents';
import { useTickets } from '../../hooks/useTickets';
import { useLanguage } from '../../i18n/LanguageContext';
import { computeDepartmentStats } from '../../lib/departmentStats';
import { formatDuration, formatRelativeTime } from '../../lib/format';
import { useSimulationStore } from '../../simulation/simulationEngine';
import { useAuthStore } from '../../store/auth.store';

const CHART_TOOLTIP_STYLE = {
  background: 'rgb(var(--mirqab-bg-elevated))',
  border: '1px solid rgb(var(--mirqab-white) / 0.1)',
  borderRadius: 12,
};

export function DashboardPage() {
  const { t } = useLanguage();
  const user = useAuthStore((state) => state.user);
  const { data: departments = [], isLoading: departmentsLoading, isError: departmentsError, refetch: refetchDepartments } = useDepartments();
  const { data: devices = [], isLoading: devicesLoading, isError: devicesError, refetch: refetchDevices } = useDevices();
  const { data: incidents = [], isLoading: incidentsLoading, isError: incidentsError, refetch: refetchIncidents } = useIncidents();
  const { data: tickets = [], isLoading: ticketsLoading, isError: ticketsError, refetch: refetchTickets } = useTickets();
  const dashboardLoading = departmentsLoading || devicesLoading || incidentsLoading || ticketsLoading;
  const dashboardError = departmentsError || devicesError || incidentsError || ticketsError;
  const isRunning = useSimulationStore((state) => state.isRunning);
  const start = useSimulationStore((state) => state.start);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);

  const departmentStats = useMemo(
    () => computeDepartmentStats(departments, devices, incidents),
    [departments, devices, incidents],
  );
  const openTickets = tickets.filter(
    (ticket) => ticket.status === 'open' || ticket.status === 'in-progress',
  );

  function departmentName(id: string | null): string {
    return departments.find((dept) => dept.id === id)?.name ?? t('dashboard.unknownDepartment');
  }
  function deviceHostname(id: string | null): string {
    return devices.find((device) => device.id === id)?.hostname ?? t('dashboard.unknownDevice');
  }

  const critical = incidents.filter((i) => i.severity === 'critical' && !i.acknowledged);
  const high = incidents.filter((i) => i.severity === 'high' && !i.acknowledged);
  const deptAtRisk = departmentStats.filter(
    (d) => d.worstSeverity === 'high' || d.worstSeverity === 'critical',
  );

  const activeIncidents = useMemo(
    () =>
      incidents
        .filter((i) => i.status === 'open')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 8),
    [incidents],
  );

  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const incident of incidents) counts[incident.severity] += 1;
    return Object.entries(counts)
      .filter(([, value]) => value > 0)
      .map(([severity, value]) => ({ name: severity, value }));
  }, [incidents]);

  const attackTrend = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const incident of incidents) {
      const minute = new Date(incident.createdAt);
      minute.setSeconds(0, 0);
      const key = minute.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return Array.from(buckets.entries())
      .map(([time, count]) => ({ time, count }))
      .slice(-20);
  }, [incidents]);

  const departmentRisk = useMemo(
    () =>
      departmentStats.map((dept) => ({
        department: dept.name,
        openAlerts: dept.openAlerts,
        score: dept.avgScore,
      })),
    [departmentStats],
  );

  const attackTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const incident of incidents) {
      const key = `${incident.technique.id} ${incident.technique.name}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([technique, count]) => ({ technique, count }));
  }, [incidents]);

  const aiCoverage = useMemo(() => {
    const claude = incidents.filter((i) => i.generatedBy === 'claude').length;
    const ruleBased = incidents.length - claude;
    return [
      { name: t('dashboard.analytics.aiClaude'), value: claude },
      { name: t('dashboard.analytics.aiRuleBased'), value: ruleBased },
    ].filter((entry) => entry.value > 0);
  }, [incidents, t]);

  const { mttd, mttr } = useMemo(() => {
    const respondTimes = incidents
      .filter((i) => i.status !== 'open')
      .map((i) => new Date(i.updatedAt).getTime() - new Date(i.createdAt).getTime())
      .filter((ms) => ms >= 0);
    const resolveTimes = incidents
      .filter((i) => i.status === 'resolved')
      .map((i) => new Date(i.updatedAt).getTime() - new Date(i.createdAt).getTime())
      .filter((ms) => ms >= 0);
    const avg = (values: number[]) =>
      values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    return { mttd: avg(respondTimes), mttr: avg(resolveTimes) };
  }, [incidents]);

  if (dashboardLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <LoadingState label="Loading dashboard…" />
        </Card>
      </div>
    );
  }

  if (dashboardError) {
    return (
      <div className="space-y-6">
        <ErrorState
          description="Couldn't load dashboard data from the backend."
          action={
            <button
              onClick={() => {
                refetchDepartments();
                refetchDevices();
                refetchIncidents();
                refetchTickets();
              }}
              className="text-xs font-medium text-mirqab-accent hover:underline"
            >
              Retry
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">
            {t('dashboard.welcome')}
            {user ? `, ${user.firstName}` : ''}
          </h1>
          <p className="text-sm text-slate-400">{t('dashboard.subtitle')}</p>
        </div>
        {!isRunning && (
          <Button disabled={devices.length === 0} onClick={() => start(devices)}>
            <Play className="h-4 w-4" />
            {t('dashboard.startSimulation')}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          icon={ShieldAlert}
          tone="red"
          label={t('dashboard.stats.critical')}
          value={String(critical.length)}
        />
        <StatTile
          icon={Flame}
          tone="orange"
          label={t('dashboard.stats.highRisk')}
          value={String(high.length)}
        />
        <StatTile
          icon={Bell}
          tone="blue"
          label={t('dashboard.stats.totalAlerts')}
          value={String(incidents.length)}
        />
        <StatTile
          icon={TicketIcon}
          tone="pink"
          label={t('dashboard.stats.openTickets')}
          value={String(openTickets.length)}
        />
        <StatTile
          icon={Building2}
          tone="purple"
          label={t('dashboard.stats.deptAtRisk')}
          value={String(deptAtRisk.length)}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="flex flex-col lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">{t('dashboard.activeIncidents')}</h3>
            <span className="text-xs text-slate-500">{activeIncidents.length}</span>
          </div>
          {activeIncidents.length === 0 ? (
            <p className="text-sm text-slate-500">{t('dashboard.noActiveIncidents')}</p>
          ) : (
            <ul className="space-y-2 overflow-y-auto">
              <AnimatePresence initial={false}>
                {activeIncidents.map((incident) => (
                  <motion.li
                    key={incident.id}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                  >
                    <button
                      onClick={() => setSelectedIncidentId(incident.id)}
                      style={{ borderInlineStartColor: SEVERITY_COLOR[incident.severity] }}
                      className="w-full rounded-xl2 border border-white/5 border-s-4 bg-white/5 p-3 text-start transition hover:bg-white/[0.08]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-slate-100">{incident.title}</p>
                        <SeverityBadge severity={incident.severity} />
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        {departmentName(incident.departmentId)} ·{' '}
                        {deviceHostname(incident.deviceId)}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-600">
                        {formatRelativeTime(incident.createdAt)}
                      </p>
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              {t('dashboard.liveNetworkTopology')}
            </h3>
            <p className="text-xs text-slate-500">{t('dashboard.topologyHint')}</p>
          </div>
          <ThreatTopology
            departments={departments}
            devices={devices}
            alerts={incidents}
            height={440}
            onOpenIncident={(incidentId) => setSelectedIncidentId(incidentId)}
          />
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          {t('dashboard.analytics.title')}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card glow="purple">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              {t('dashboard.analytics.mttd')}
            </p>
            <p className="mt-1 text-2xl font-bold text-white">
              {mttd !== null ? formatDuration(mttd) : '—'}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">{t('dashboard.analytics.mttdHint')}</p>
          </Card>
          <Card glow="pink">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              {t('dashboard.analytics.mttr')}
            </p>
            <p className="mt-1 text-2xl font-bold text-white">
              {mttr !== null ? formatDuration(mttr) : '—'}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">{t('dashboard.analytics.mttrHint')}</p>
          </Card>
          <Card className="sm:col-span-2">
            <h3 className="mb-2 text-sm font-semibold text-white">
              {t('dashboard.analytics.aiPredictions')}
            </h3>
            {aiCoverage.length === 0 ? (
              <p className="text-sm text-slate-500">{t('dashboard.noIncidents')}</p>
            ) : (
              <ResponsiveContainer width="100%" height={120}>
                <PieChart>
                  <Pie
                    data={aiCoverage}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={30}
                    outerRadius={50}
                  >
                    <Cell fill="#7C3AED" />
                    <Cell fill="#3B82F6" />
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <h3 className="mb-4 text-sm font-semibold text-white">
              {t('dashboard.analytics.attackTrends')}
            </h3>
            {attackTrend.length === 0 ? (
              <p className="text-sm text-slate-500">{t('dashboard.noIncidents')}</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={attackTrend}>
                  <CartesianGrid stroke="rgb(var(--mirqab-white) / 0.06)" />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#7C3AED"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card>
            <h3 className="mb-4 text-sm font-semibold text-white">
              {t('dashboard.analytics.severityDistribution')}
            </h3>
            {severityCounts.length === 0 ? (
              <p className="text-sm text-slate-500">{t('dashboard.noIncidents')}</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={severityCounts}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={45}
                    outerRadius={70}
                  >
                    {severityCounts.map((entry) => (
                      <Cell key={entry.name} fill={SEVERITY_COLOR[entry.name]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card>
            <h3 className="mb-4 text-sm font-semibold text-white">
              {t('dashboard.analytics.departmentRisk')}
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={departmentRisk}>
                <CartesianGrid stroke="rgb(var(--mirqab-white) / 0.06)" />
                <XAxis dataKey="department" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Bar dataKey="openAlerts" fill="#EC4899" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card>
            <h3 className="mb-4 text-sm font-semibold text-white">
              {t('dashboard.analytics.attackTypes')}
            </h3>
            {attackTypes.length === 0 ? (
              <p className="text-sm text-slate-500">{t('dashboard.noIncidents')}</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={attackTypes} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid stroke="rgb(var(--mirqab-white) / 0.06)" />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                  />
                  <YAxis
                    type="category"
                    dataKey="technique"
                    width={160}
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                  />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Bar dataKey="count" fill="#10B981" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>
      </div>

      <IncidentInvestigationPanel
        incidentId={selectedIncidentId}
        departments={departments}
        devices={devices}
        onClose={() => setSelectedIncidentId(null)}
      />
    </div>
  );
}

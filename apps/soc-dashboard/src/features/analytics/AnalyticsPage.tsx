import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '../../components/ui/Card';
import { useDepartments } from '../../hooks/useDepartments';
import { useIncidents } from '../../hooks/useIncidents';

const CHART_TOOLTIP_STYLE = {
  background: 'rgb(var(--mirqab-bg-elevated))',
  border: '1px solid rgb(var(--mirqab-white) / 0.1)',
  borderRadius: 12,
};

export function AnalyticsPage() {
  const { data: alerts = [] } = useIncidents();
  const { data: departments = [] } = useDepartments();

  function departmentName(id: string | null): string {
    return departments.find((dept) => dept.id === id)?.name ?? 'Unknown department';
  }

  const overTime = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const alert of alerts) {
      const minute = new Date(alert.createdAt);
      minute.setSeconds(0, 0);
      const key = minute.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return Array.from(buckets.entries())
      .map(([time, count]) => ({ time, count }))
      .slice(-20);
  }, [alerts]);

  const bySeverity = useMemo(() => {
    const counts: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const alert of alerts) counts[alert.severity] += 1;
    return Object.entries(counts).map(([severity, count]) => ({ severity, count }));
  }, [alerts]);

  const byDepartment = useMemo(() => {
    const counts = new Map<string, number>();
    for (const alert of alerts) {
      const key = alert.departmentId ?? 'unassigned';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([departmentId, count]) => ({
      department: departmentId === 'unassigned' ? 'Unassigned' : departmentName(departmentId),
      count,
    }));
  }, [alerts]);

  const byTechnique = useMemo(() => {
    const counts = new Map<string, number>();
    for (const alert of alerts) {
      const key = `${alert.technique.id} ${alert.technique.name}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([technique, count]) => ({ technique, count }));
  }, [alerts]);

  if (alerts.length === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-500">
          No alert data yet. Start Simulation Mode from the topbar to populate these charts.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <h3 className="mb-4 text-sm font-semibold text-white">Alerts over time</h3>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={overTime}>
            <CartesianGrid stroke="rgb(var(--mirqab-white) / 0.06)" />
            <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
            <Line type="monotone" dataKey="count" stroke="#A855F7" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card>
        <h3 className="mb-4 text-sm font-semibold text-white">Alerts by severity</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={bySeverity}>
            <CartesianGrid stroke="rgb(var(--mirqab-white) / 0.06)" />
            <XAxis dataKey="severity" tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
            <Bar dataKey="count" fill="#F59E0B" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card>
        <h3 className="mb-4 text-sm font-semibold text-white">Alerts by department</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={byDepartment}>
            <CartesianGrid stroke="rgb(var(--mirqab-white) / 0.06)" />
            <XAxis dataKey="department" tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
            <Bar dataKey="count" fill="#A855F7" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card>
        <h3 className="mb-4 text-sm font-semibold text-white">
          MITRE ATT&amp;CK technique frequency
        </h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={byTechnique} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid stroke="rgb(var(--mirqab-white) / 0.06)" />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <YAxis
              type="category"
              dataKey="technique"
              width={160}
              tick={{ fontSize: 10, fill: '#94a3b8' }}
            />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
            <Bar dataKey="count" fill="#22C55E" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

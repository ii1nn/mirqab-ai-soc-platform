import { useMemo, useState } from 'react';
import { Badge, SeverityBadge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { useDepartments } from '../../hooks/useDepartments';
import { useDevices } from '../../hooks/useDevices';
import { useIncidents, useSimilarIncidents } from '../../hooks/useIncidents';
import { useIncidentHistory } from '../../hooks/useInvestigation';
import { formatDateTime } from '../../lib/format';

export function IncidentMemoryPage() {
  const { data: allIncidents = [] } = useIncidents();
  const { data: departments = [] } = useDepartments();
  const { data: devices = [] } = useDevices();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // High/critical only — "Incident Memory" is for escalated incidents, not every low-severity alert.
  const incidents = useMemo(
    () =>
      allIncidents.filter(
        (incident) => incident.severity === 'high' || incident.severity === 'critical',
      ),
    [allIncidents],
  );

  const selected = incidents.find((incident) => incident.id === selectedId) ?? incidents[0] ?? null;
  const { data: similar = [] } = useSimilarIncidents(selected?.id ?? null);
  const { data: history } = useIncidentHistory(selected?.id ?? null);

  function departmentName(id: string | null): string {
    return departments.find((dept) => dept.id === id)?.name ?? 'Unknown department';
  }

  function deviceHostname(id: string | null): string {
    return devices.find((device) => device.id === id)?.hostname ?? 'Unknown device';
  }

  if (incidents.length === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-500">
          No high/critical incidents recorded yet — start Simulation Mode from the topbar, or wait
          for a real high-severity alert.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <h2 className="mb-3 text-sm font-semibold text-white">Incident memory</h2>
        <ul className="space-y-2">
          {incidents.map((incident) => (
            <li key={incident.id}>
              <button
                onClick={() => setSelectedId(incident.id)}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  selected?.id === incident.id
                    ? 'border-mirqab-accent/40 bg-mirqab-accent/5'
                    : 'border-white/5 bg-white/5 hover:border-white/10'
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-200">{incident.title}</p>
                  <SeverityBadge severity={incident.severity} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {deviceHostname(incident.deviceId)} · {departmentName(incident.departmentId)} ·{' '}
                  {incident.technique.id} {incident.technique.name}
                </p>
                <p className="mt-1 text-[11px] text-slate-600">
                  {formatDateTime(incident.createdAt)}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-white">Similar incidents</h3>
        <p className="mb-3 text-xs text-slate-500">
          Powered by the real Incident Similarity Engine — a feature-hashed embedding compared by
          cosine similarity, the same exact-search a FAISS <code>IndexFlatIP</code> performs.
        </p>
        {similar.length === 0 ? (
          <p className="text-sm text-slate-500">No sufficiently similar incidents found.</p>
        ) : (
          <ul className="space-y-2">
            {similar.map(({ incident, score }) => (
              <li
                key={incident.id}
                className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 p-3"
              >
                <div>
                  <p className="text-sm text-slate-200">{incident.title}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(incident.createdAt)}</p>
                </div>
                <Badge status="unknown">{Math.round(score * 100)}% match</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="lg:col-span-3">
        <h3 className="mb-3 text-sm font-semibold text-white">Timeline</h3>
        {!history || history.timeline.length === 0 ? (
          <p className="text-sm text-slate-500">
            No timeline events recorded for this incident yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {history.timeline.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start justify-between gap-4 border-b border-white/5 pb-3"
              >
                <div>
                  <p className="text-sm font-medium text-slate-200">{entry.event}</p>
                  {entry.description && (
                    <p className="mt-1 text-xs text-slate-500">{entry.description}</p>
                  )}
                  {entry.performedBy && (
                    <p className="mt-1 text-xs text-slate-600">by {entry.performedBy}</p>
                  )}
                </div>
                <p className="shrink-0 text-xs text-slate-500">{formatDateTime(entry.timestamp)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

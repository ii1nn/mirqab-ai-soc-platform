import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { MockBadge } from '../../components/ui/MockBadge';
import { useSecurityScore } from '../../hooks/useSecurityScore';
import { formatRelativeTime } from '../../lib/format';
import { getIncidentHistory } from '../../services/incidents.service';
import type { IncidentSeverity } from '../../types/domain';

const SEVERITY_TO_STATUS: Record<IncidentSeverity, 'success' | 'warning' | 'danger'> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
};

export function IncidentHistoryPage() {
  const { result } = useSecurityScore();
  const incidents = getIncidentHistory(result);

  return (
    <Card>
      <h2 className="mb-4 text-sm font-semibold text-white">Incident history</h2>
      {incidents.length === 0 ? (
        <p className="text-sm text-slate-500">No incidents recorded for this device.</p>
      ) : (
        <ul className="space-y-3">
          {incidents.map((incident) => (
            <li
              key={incident.id}
              className="flex items-start justify-between gap-4 border-b border-white/5 pb-3"
            >
              <div>
                <p className="text-sm font-medium text-slate-200">{incident.title}</p>
                <p className="mt-1 text-xs text-slate-500">{incident.description}</p>
                <p className="mt-1 text-xs text-slate-600">{formatRelativeTime(incident.detectedAt)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {incident.source === 'mock' && <MockBadge />}
                <Badge status={SEVERITY_TO_STATUS[incident.severity]}>{incident.severity}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

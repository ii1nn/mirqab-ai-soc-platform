import { AnimatePresence, motion } from 'framer-motion';
import { Badge, SeverityBadge } from '../ui/Badge';
import { formatRelativeTime } from '../../lib/format';
import type { AlertRecord, Department, VirtualDevice } from '../../types/domain';

interface AlertsFeedProps {
  alerts: AlertRecord[];
  departments: Department[];
  devices: VirtualDevice[];
  limit?: number;
  onAcknowledge?: (id: string) => void;
  /** Opens the Incident Response panel for the clicked alert/device. */
  onSelect?: (incidentId: string) => void;
  emptyHint?: string;
}

export function AlertsFeed({
  alerts,
  departments,
  devices,
  limit = 8,
  onAcknowledge,
  onSelect,
  emptyHint = 'No alerts yet. Start Simulation Mode from the topbar to see live activity.',
}: AlertsFeedProps) {
  const visible = alerts.slice(0, limit);

  if (visible.length === 0) {
    return <p className="text-sm text-slate-500">{emptyHint}</p>;
  }

  function departmentName(id: string | null): string {
    return departments.find((dept) => dept.id === id)?.name ?? 'Unknown department';
  }

  function deviceHostname(id: string | null): string {
    return devices.find((device) => device.id === id)?.hostname ?? 'Unknown device';
  }

  return (
    <ul className="space-y-2">
      <AnimatePresence initial={false}>
        {visible.map((alert) => (
          <motion.li
            key={alert.id}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            onClick={onSelect ? () => onSelect(alert.id) : undefined}
            className={`flex items-start justify-between gap-3 rounded-xl border border-white/5 bg-white/5 p-3 ${onSelect ? 'cursor-pointer hover:border-mirqab-accent/40' : ''}`}
          >
            <div>
              <p className="text-sm font-medium text-slate-100">{alert.title}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {deviceHostname(alert.deviceId)} · {departmentName(alert.departmentId)} ·{' '}
                {alert.technique.id} {alert.technique.name}
              </p>
              <p className="mt-1 text-[11px] text-slate-600">
                {formatRelativeTime(alert.createdAt)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <SeverityBadge severity={alert.severity} />
              {onAcknowledge && !alert.acknowledged && (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onAcknowledge(alert.id);
                  }}
                  className="text-xs text-mirqab-accent hover:underline"
                >
                  Acknowledge
                </button>
              )}
              {alert.acknowledged && <Badge status="unknown">Acked</Badge>}
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

import { Cpu, HardDrive, MemoryStick, ScanSearch } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ScoreGauge } from '../../components/ui/ScoreGauge';
import { StatTile } from '../../components/ui/StatTile';
import { useDeviceMetrics } from '../../hooks/useDeviceMetrics';
import { useSecurityScore } from '../../hooks/useSecurityScore';
import { formatBytes } from '../../lib/format';
import { useNotificationsStore } from '../../store/notifications.store';

const STATUS_TEXT_CLASS: Record<string, string> = {
  success: 'text-mirqab-success',
  warning: 'text-mirqab-warning',
  danger: 'text-mirqab-danger',
  unknown: 'text-slate-500',
};

export function DashboardPage() {
  const { result, isLoading } = useSecurityScore();
  const { data: metrics } = useDeviceMetrics();
  const notifications = useNotificationsStore((state) => state.items.slice(0, 3));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card className="flex flex-col items-center justify-center gap-4 lg:col-span-1">
        {isLoading || !result ? (
          <p className="text-sm text-slate-400">Calculating security score…</p>
        ) : (
          <>
            <ScoreGauge score={result.score} />
            <div className="w-full space-y-2">
              {result.checks.map((check) => (
                <div key={check.id} className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">{check.label}</span>
                  <span className={STATUS_TEXT_CLASS[check.status]}>{check.status}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-2 lg:content-start">
        <StatTile
          icon={Cpu}
          label="CPU load"
          value={metrics ? `${metrics.cpuLoadPercent}%` : '—'}
          tone={metrics && metrics.cpuLoadPercent >= 85 ? 'warning' : 'success'}
        />
        <StatTile
          icon={MemoryStick}
          label="Memory used"
          value={metrics ? `${metrics.memoryUsedPercent}%` : '—'}
          hint={
            metrics
              ? `${formatBytes(metrics.totalMemoryBytes - metrics.freeMemoryBytes)} used`
              : undefined
          }
          tone={metrics && metrics.memoryUsedPercent >= 90 ? 'warning' : 'success'}
        />
        <StatTile
          icon={HardDrive}
          label="Disks"
          value={metrics ? `${metrics.disks.length}` : '—'}
          hint="See Device Health for details"
        />

        <Card className="flex items-center justify-between sm:col-span-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Run an AI security scan</h3>
            <p className="mt-1 text-xs text-slate-400">
              Checks running processes and your current protection status.
            </p>
          </div>
          <Link to="/scan">
            <Button>
              <ScanSearch className="h-4 w-4" />
              Scan now
            </Button>
          </Link>
        </Card>

        <Card className="sm:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Recent notifications</h3>
            <Link to="/notifications" className="text-xs text-mirqab-accent hover:underline">
              View all
            </Link>
          </div>
          {notifications.length === 0 ? (
            <p className="text-xs text-slate-500">No notifications yet.</p>
          ) : (
            <ul className="space-y-2">
              {notifications.map((notification) => (
                <li key={notification.id} className="text-xs text-slate-300">
                  <span className="font-medium text-white">{notification.title}</span>
                  <span className="ml-2 text-slate-500">{notification.body}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

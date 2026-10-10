import { useEffect, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { useDeviceMetrics } from '../../hooks/useDeviceMetrics';
import { formatBytes, formatDuration } from '../../lib/format';

interface HistoryPoint {
  time: string;
  cpu: number;
  memory: number;
}

const MAX_HISTORY_POINTS = 30;

export function DeviceHealthPage() {
  const { data: metrics, isLoading } = useDeviceMetrics();
  const [history, setHistory] = useState<HistoryPoint[]>([]);

  useEffect(() => {
    if (!metrics) return;
    setHistory((prev) =>
      [
        ...prev,
        {
          time: new Date().toLocaleTimeString(),
          cpu: metrics.cpuLoadPercent,
          memory: metrics.memoryUsedPercent,
        },
      ].slice(-MAX_HISTORY_POINTS),
    );
  }, [metrics]);

  if (isLoading || !metrics) {
    return <p className="text-sm text-slate-400">Loading device health…</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <h3 className="mb-4 text-sm font-semibold text-white">
          CPU &amp; memory (last {history.length} samples)
        </h3>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={history}>
            <defs>
              <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00E5FF" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#00E5FF" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="memGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22C55E" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#22C55E" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="time" hide />
            <YAxis domain={[0, 100]} hide />
            <Tooltip
              contentStyle={{
                background: '#111827',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 12,
              }}
              labelStyle={{ color: '#94a3b8' }}
            />
            <Area
              type="monotone"
              dataKey="cpu"
              name="CPU %"
              stroke="#00E5FF"
              fill="url(#cpuGradient)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="memory"
              name="Memory %"
              stroke="#22C55E"
              fill="url(#memGradient)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-white">Protection status</h3>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Windows Defender</span>
              <Badge
                status={
                  !metrics.defender.supported
                    ? 'unknown'
                    : metrics.defender.antivirusEnabled
                      ? 'success'
                      : 'danger'
                }
              >
                {!metrics.defender.supported
                  ? 'Unknown'
                  : metrics.defender.antivirusEnabled
                    ? 'Enabled'
                    : 'Disabled'}
              </Badge>
            </div>
            {metrics.firewall.profiles.length === 0 && (
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Firewall</span>
                <Badge status="unknown">Unknown</Badge>
              </div>
            )}
            {metrics.firewall.profiles.map((profile) => (
              <div key={profile.name} className="flex items-center justify-between">
                <span className="text-slate-400">Firewall — {profile.name}</span>
                <Badge status={profile.enabled ? 'success' : 'danger'}>
                  {profile.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Uptime</span>
              <span className="text-slate-200">{formatDuration(metrics.uptimeSeconds)}</span>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="mb-3 text-sm font-semibold text-white">Disks</h3>
          {metrics.disks.length === 0 ? (
            <p className="text-sm text-slate-500">Disk usage is not available on this platform.</p>
          ) : (
            <div className="space-y-3">
              {metrics.disks.map((disk) => {
                const usedPercent = Math.round(
                  ((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 100,
                );
                return (
                  <div key={disk.drive}>
                    <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                      <span>{disk.drive}</span>
                      <span>
                        {formatBytes(disk.totalBytes - disk.freeBytes)} / {formatBytes(disk.totalBytes)}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-mirqab-accent"
                        style={{ width: `${usedPercent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

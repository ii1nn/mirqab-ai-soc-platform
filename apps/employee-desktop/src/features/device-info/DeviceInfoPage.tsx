import clsx from 'clsx';
import { useState } from 'react';
import { Card } from '../../components/ui/Card';
import { useDeviceInfo } from '../../hooks/useDeviceInfo';
import { useInstalledApps } from '../../hooks/useInstalledApps';
import { useProcesses } from '../../hooks/useProcesses';
import { formatBytes } from '../../lib/format';

const TABS = ['Overview', 'Processes', 'Installed apps'] as const;
type Tab = (typeof TABS)[number];

export function DeviceInfoPage() {
  const [tab, setTab] = useState<Tab>('Overview');
  const { data: info } = useDeviceInfo();
  const { data: processes, isLoading: processesLoading } = useProcesses();
  const { data: apps, isLoading: appsLoading } = useInstalledApps();

  return (
    <div className="space-y-4">
      <div className="flex w-fit gap-1 rounded-xl bg-white/5 p-1">
        {TABS.map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={clsx(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition',
              tab === item ? 'bg-mirqab-accent text-mirqab-primary' : 'text-slate-400 hover:text-white',
            )}
          >
            {item}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <Card>
          {!info ? (
            <p className="text-sm text-slate-400">Loading device information…</p>
          ) : (
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <Field label="Hostname" value={info.hostname} />
              <Field label="Platform" value={info.platform} />
              <Field label="OS release" value={info.osRelease} />
              <Field label="Architecture" value={info.arch} />
              <Field label="CPU" value={info.cpuModel} />
              <Field label="CPU cores" value={String(info.cpuCores)} />
              <Field label="Total memory" value={formatBytes(info.totalMemoryBytes)} />
            </dl>
          )}
        </Card>
      )}

      {tab === 'Processes' && (
        <Card>
          {processesLoading ? (
            <p className="text-sm text-slate-400">Loading processes…</p>
          ) : !processes || processes.length === 0 ? (
            <p className="text-sm text-slate-500">Process list is not available on this platform.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="pb-2">Process</th>
                  <th className="pb-2">PID</th>
                  <th className="pb-2">CPU time (s)</th>
                  <th className="pb-2">Memory</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {processes.map((proc) => (
                  <tr key={proc.pid}>
                    <td className="py-2 text-slate-200">{proc.name}</td>
                    <td className="py-2 text-slate-400">{proc.pid}</td>
                    <td className="py-2 text-slate-400">{proc.cpuSeconds.toFixed(1)}</td>
                    <td className="py-2 text-slate-400">{formatBytes(proc.memoryBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === 'Installed apps' && (
        <Card>
          {appsLoading ? (
            <p className="text-sm text-slate-400">Loading installed applications…</p>
          ) : !apps || apps.length === 0 ? (
            <p className="text-sm text-slate-500">
              Installed application list is not available on this platform.
            </p>
          ) : (
            <ul className="max-h-96 space-y-2 overflow-y-auto text-sm">
              {apps.map((app) => (
                <li
                  key={app.name}
                  className="flex items-center justify-between border-b border-white/5 pb-2"
                >
                  <span className="text-slate-200">{app.name}</span>
                  <span className="text-xs text-slate-500">
                    {app.publisher ?? 'Unknown publisher'} {app.version ? `· v${app.version}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-200">{value}</dd>
    </div>
  );
}

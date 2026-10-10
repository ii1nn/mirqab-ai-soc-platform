import clsx from 'clsx';
import type { VirtualDevice } from '../../types/domain';
import { DEVICE_STATE_DOT_CLASS, DEVICE_STATE_LABEL, deriveDeviceState } from './deviceState';

interface EndpointGridProps {
  devices: VirtualDevice[];
  selectedDeviceId: string | null;
  onSelect: (deviceId: string) => void;
}

/** Compact real per-device list — hostname, IP, and live status dot for
 * every managed endpoint. Complements ThreatTopology's department-level
 * graph with the individual-device view the Live Map was missing. */
export function EndpointGrid({ devices, selectedDeviceId, onSelect }: EndpointGridProps) {
  return (
    <ul className="space-y-1">
      {devices.map((device) => {
        const state = deriveDeviceState(device);
        const selected = device.id === selectedDeviceId;
        return (
          <li key={device.id}>
            <button
              onClick={() => onSelect(device.id)}
              className={clsx(
                'flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors',
                selected
                  ? 'border-mirqab-accent bg-mirqab-accent/10'
                  : 'border-white/5 bg-mirqab-black/20 hover:border-white/20',
              )}
            >
              <span
                className={clsx('h-2 w-2 shrink-0 rounded-full', DEVICE_STATE_DOT_CLASS[state])}
                title={DEVICE_STATE_LABEL[state]}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[11px] font-medium text-slate-200">
                  {device.hostname}
                </span>
                <span className="truncate text-[10px] text-slate-500">
                  {device.ipAddress || 'No IP recorded'}
                </span>
              </span>
              {device.activeIncidentCount > 0 && (
                <span className="shrink-0 rounded-full bg-mirqab-danger/20 px-1.5 py-0.5 text-[10px] font-semibold text-mirqab-danger">
                  {device.activeIncidentCount}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

import { Building2, Unplug, X } from 'lucide-react';
import { useMemo } from 'react';
import { Badge, SeverityBadge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { DEVICE_STATE_BADGE_STATUS, DEVICE_STATE_LABEL, deriveDeviceState } from '../citadel/deviceState';
import type { AlertRecord, Department, VirtualDevice } from '../../types/domain';

/** Incidents still open enough to matter for a department's risk view —
 * same "not yet closed out" grouping DevicePanel.tsx uses for its own
 * active-incidents list. */
const ACTIVE_STATUSES: AlertRecord['status'][] = ['open', 'investigating', 'contained'];

interface DepartmentPanelProps {
  department: Department | null;
  devices: VirtualDevice[];
  incidents: AlertRecord[];
  onClose: () => void;
  onSelectDevice: (deviceId: string) => void;
  onSelectIncident: (incidentId: string) => void;
}

export function DepartmentPanel({
  department,
  devices,
  incidents,
  onClose,
  onSelectDevice,
  onSelectIncident,
}: DepartmentPanelProps) {
  const deptDevices = useMemo(
    () => (department ? devices.filter((device) => device.departmentId === department.id) : []),
    [department, devices],
  );
  const deptIncidents = useMemo(
    () =>
      department
        ? incidents
            .filter((incident) => incident.departmentId === department.id)
            .filter((incident) => ACTIVE_STATUSES.includes(incident.status))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        : [],
    [department, incidents],
  );
  const isolatedCount = deptDevices.filter((device) => device.isolated).length;

  if (!department) return null;

  return (
    <Card
      className="fixed inset-y-4 start-4 z-30 flex w-full max-w-sm flex-col overflow-hidden"
      glow="purple"
    >
      <button
        onClick={onClose}
        className="absolute right-3 top-3 rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
        aria-label="Close department panel"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-center gap-2.5 pr-8">
        <Building2 className="h-5 w-5 text-mirqab-accent" />
        <h2 className="text-sm font-semibold text-white">{department.name}</h2>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <StatTile label="Open incidents" value={String(deptIncidents.length)} />
        <StatTile label="Isolated devices" value={String(isolatedCount)} />
        <StatTile label="Devices" value={String(deptDevices.length)} />
      </div>

      <div className="mt-4 flex-1 space-y-4 overflow-y-auto">
        <section>
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Devices
          </h3>
          {deptDevices.length === 0 ? (
            <p className="text-[11px] text-slate-500">No devices in this department.</p>
          ) : (
            <ul className="space-y-1">
              {deptDevices.map((device) => {
                const state = deriveDeviceState(device);
                return (
                  <li key={device.id}>
                    <button
                      onClick={() => onSelectDevice(device.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/5 bg-mirqab-black/20 px-2 py-1.5 text-left hover:border-white/20"
                    >
                      <span className="flex items-center gap-1.5 truncate text-[11px] text-slate-200">
                        {device.hostname}
                        {device.isolated && <Unplug className="h-3 w-3 text-slate-400" />}
                      </span>
                      <Badge status={DEVICE_STATE_BADGE_STATUS[state]}>
                        {DEVICE_STATE_LABEL[state]}
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Relevant incidents
          </h3>
          {deptIncidents.length === 0 ? (
            <p className="text-[11px] text-slate-500">No active incidents for this department.</p>
          ) : (
            <ul className="space-y-1">
              {deptIncidents.map((incident) => (
                <li key={incident.id}>
                  <button
                    onClick={() => onSelectIncident(incident.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/5 bg-mirqab-black/20 px-2 py-1.5 text-left hover:border-white/20"
                  >
                    <span className="truncate text-[11px] text-slate-200">{incident.title}</span>
                    <SeverityBadge severity={incident.severity} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Card>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/5 px-2 py-2">
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  );
}

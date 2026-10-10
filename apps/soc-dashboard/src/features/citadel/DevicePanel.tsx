import { AlertTriangle, Loader2, ShieldAlert, ShieldOff, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useIncidentHistory, useLogIncidentAction } from '../../hooks/useInvestigation';
import { formatDateTime } from '../../lib/format';
import type { AlertRecord, VirtualDevice } from '../../types/domain';
import { DEVICE_STATE_BADGE_STATUS, DEVICE_STATE_LABEL, deriveDeviceState } from './deviceState';
import { deriveResponseStatus, estimateArrival } from './responseStatus';

/** Incidents still open enough to matter for isolation/response display —
 * matches the backend's own "not yet closed out" grouping. */
const ACTIVE_STATUSES: AlertRecord['status'][] = ['open', 'investigating', 'contained'];

interface DevicePanelProps {
  device: VirtualDevice | null;
  incidents: AlertRecord[];
  onClose: () => void;
  onOpenIncident: (incidentId: string) => void;
}

export function DevicePanel({ device, incidents, onClose, onOpenIncident }: DevicePanelProps) {
  const deviceIncidents = useMemo(
    () =>
      device
        ? incidents
            .filter((incident) => incident.deviceId === device.id)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        : [],
    [device, incidents],
  );
  const activeIncidents = deviceIncidents.filter((incident) =>
    ACTIVE_STATUSES.includes(incident.status),
  );
  // The incident the Isolate action and response-status/ETA sections act
  // against — the most recently created active case for this device, if any.
  const primaryIncident = activeIncidents[0] ?? null;

  const { data: history, isLoading: isHistoryLoading } = useIncidentHistory(
    primaryIncident?.id ?? null,
  );
  const logAction = useLogIncidentAction(primaryIncident?.id ?? null);
  const [showConfirm, setShowConfirm] = useState(false);

  if (!device) return null;

  const state = deriveDeviceState(device);
  const responseStatus = history ? deriveResponseStatus(history) : null;
  const arrival = estimateArrival(history, Boolean(primaryIncident) && isHistoryLoading);

  const lastAction = logAction.data;
  const isolationRequestPending = lastAction?.outcome === 'pending';
  const isolationFailed = logAction.isError || lastAction?.outcome === 'failed';

  const canIsolate = Boolean(primaryIncident) && !device.isolated && !logAction.isPending;

  function requestIsolate() {
    setShowConfirm(false);
    logAction.mutate({ type: 'isolate-device', notes: 'Isolated from The Citadel Live Map' });
  }

  return (
    <Card className="relative flex max-h-[46vh] flex-col overflow-hidden" glow="blue">
      <button
        onClick={onClose}
        className="absolute right-3 top-3 rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
        aria-label="Close device panel"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-center gap-3 pr-8">
        <h2 className="text-sm font-semibold text-white">{device.hostname}</h2>
        <Badge status={DEVICE_STATE_BADGE_STATUS[state]}>{DEVICE_STATE_LABEL[state]}</Badge>
      </div>

      <div className="mt-4 grid flex-1 grid-cols-3 gap-4 overflow-y-auto">
        <div className="space-y-2 text-xs">
          <Field label="Hostname" value={device.hostname} />
          <Field label="IP Address" value={device.ipAddress || 'Not available'} />
          <Field label="Operating System" value={device.os || 'Not available'} />
          <Field label="Device Status" value={DEVICE_STATE_LABEL[state]} />
          <Field label="Last Seen" value="Not available" />
          <Field label="Risk Score" value={`${device.currentScore}/100`} />
          <Field label="Active Incidents" value={String(activeIncidents.length)} />

          <div className="pt-2">
            {showConfirm ? (
              <div className="space-y-2 rounded-lg border border-mirqab-danger/30 bg-mirqab-danger/10 p-2.5">
                <p className="text-[11px] text-slate-200">
                  This will isolate <span className="font-semibold">{device.hostname}</span> from
                  the network via the incident response workflow. This action is not easily
                  reversible.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setShowConfirm(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="danger-solid" onClick={requestIsolate}>
                    Confirm Isolation
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                variant="danger"
                disabled={!canIsolate}
                onClick={() => setShowConfirm(true)}
              >
                {logAction.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Isolating…
                  </>
                ) : device.isolated ? (
                  <>
                    <ShieldOff className="h-3.5 w-3.5" /> Isolated
                  </>
                ) : (
                  <>
                    <ShieldAlert className="h-3.5 w-3.5" /> Isolate Device
                  </>
                )}
              </Button>
            )}
            {!primaryIncident && !device.isolated && (
              <p className="mt-1.5 text-[10px] text-slate-500">
                No active incident is associated with this device to isolate through.
              </p>
            )}
            {isolationFailed && (
              <p className="mt-1.5 flex items-center gap-1 text-[10px] text-mirqab-danger">
                <AlertTriangle className="h-3 w-3" /> Isolation failed. Please try again.
              </p>
            )}
            {isolationRequestPending && (
              <p className="mt-1.5 text-[10px] text-mirqab-warning">
                Isolation requested — awaiting confirmation from the endpoint control system.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Security Team Response
            </h3>
            {primaryIncident ? (
              <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-2.5">
                <Row label="Status" value={responseStatus ?? 'Loading…'} />
                <Row
                  label="Estimated Arrival"
                  value={arrival.label}
                  tone={arrival.isLive ? 'live' : 'muted'}
                />
                <Row label="Severity" value={primaryIncident.severity} />
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">No active incident response in progress.</p>
            )}
          </div>

          <div>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Active Incidents
            </h3>
            {activeIncidents.length === 0 ? (
              <p className="text-[11px] text-slate-500">None</p>
            ) : (
              <ul className="space-y-1">
                {activeIncidents.map((incident) => (
                  <li key={incident.id}>
                    <button
                      onClick={() => onOpenIncident(incident.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/5 bg-mirqab-black/20 px-2 py-1.5 text-left hover:border-white/20"
                    >
                      <span className="truncate text-[11px] text-slate-200">{incident.title}</span>
                      <Badge status={incident.severity === 'critical' ? 'danger' : 'warning'}>
                        {incident.severity}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div>
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Response Timeline
          </h3>
          {!primaryIncident ? (
            <p className="text-[11px] text-slate-500">No active incident to show a timeline for.</p>
          ) : isHistoryLoading ? (
            <p className="text-[11px] text-slate-500">Loading…</p>
          ) : !history || history.timeline.length === 0 ? (
            <p className="text-[11px] text-slate-500">No timeline events recorded yet.</p>
          ) : (
            <ol className="space-y-1.5 border-l border-white/10 pl-3">
              {history.timeline.map((entry) => (
                <li key={entry.id} className="relative text-[11px]">
                  <span className="absolute -left-[15px] top-1 h-1.5 w-1.5 rounded-full bg-mirqab-accent" />
                  <p className="text-slate-200">{entry.event}</p>
                  <p className="text-[10px] text-slate-500">{formatDateTime(entry.timestamp)}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className="truncate text-slate-200">{value}</span>
    </div>
  );
}

function Row({
  label,
  value,
  tone = 'muted',
}: {
  label: string;
  value: string;
  tone?: 'live' | 'muted';
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className={tone === 'live' ? 'font-semibold text-mirqab-accent' : 'text-slate-300'}>
        {value}
      </span>
    </div>
  );
}

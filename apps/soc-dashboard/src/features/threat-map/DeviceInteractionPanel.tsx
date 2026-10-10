import clsx from 'clsx';
import { ShieldAlert, X } from 'lucide-react';
import { useMemo } from 'react';
import { Badge, SeverityBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { deriveDeviceAlertLevel } from '../../components/widgets/ThreatTopology';
import { useLanguage } from '../../i18n/LanguageContext';
import { DEVICE_STATE_BADGE_STATUS, DEVICE_STATE_LABEL, deriveDeviceState } from '../citadel/deviceState';
import type { AlertRecord, Severity, VirtualDevice } from '../../types/domain';

const ACTIVE_STATUSES: AlertRecord['status'][] = ['open', 'investigating'];
const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

interface DeviceInteractionPanelProps {
  device: VirtualDevice | null;
  departmentName: string;
  incidents: AlertRecord[];
  onClose: () => void;
  /** Opens the real incident for viewing — no confirm step, just navigation. */
  onOpenIncident: (incidentId: string) => void;
  /** Isolation never happens here — this hands the real incident id to the
   * caller, which opens the existing IncidentInvestigationPanel straight on
   * its own real isolate-confirmation step (see ThreatMapPage). */
  onRequestIsolate: (incidentId: string) => void;
}

/**
 * A deliberately small, information-first popover for the Digital Twin's
 * device nodes — NOT a duplicate of DevicePanel.tsx (Citadel's own, richer
 * panel). Isolation is the one real security action a device can offer,
 * and only ever appears when a real Incident.deviceId match exists — never
 * fabricated to make the button available.
 */
export function DeviceInteractionPanel({
  device,
  departmentName,
  incidents,
  onClose,
  onOpenIncident,
  onRequestIsolate,
}: DeviceInteractionPanelProps) {
  const { t } = useLanguage();
  const primaryIncident = useMemo(() => {
    if (!device) return null;
    const active = incidents
      .filter((incident) => incident.deviceId === device.id)
      .filter((incident) => ACTIVE_STATUSES.includes(incident.status));
    return (
      active.sort((a, b) => {
        const rankDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
        if (rankDiff !== 0) return rankDiff;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })[0] ?? null
    );
  }, [device, incidents]);

  if (!device) return null;

  const state = deriveDeviceState(device);
  const canIsolate = Boolean(primaryIncident) && !device.isolated;
  const alertLevel = deriveDeviceAlertLevel(device, primaryIncident?.severity ?? null);

  return (
    <Card className="relative flex flex-col overflow-hidden" glow="blue">
      <button
        onClick={onClose}
        className="absolute right-3 top-3 rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
        aria-label="Close device panel"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="pr-8">
        <h2 className="text-sm font-semibold text-white">{device.hostname}</h2>
        <p className="text-xs text-slate-500">{departmentName}</p>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Badge status={DEVICE_STATE_BADGE_STATUS[state]}>{DEVICE_STATE_LABEL[state]}</Badge>
        <span className="text-xs text-slate-500">Risk score: {device.currentScore}/100</span>
      </div>

      {alertLevel && (
        <p
          className={clsx(
            'mt-2 text-xs font-semibold',
            alertLevel === 'isolation-required' ? 'text-mirqab-danger' : 'text-mirqab-warning',
          )}
        >
          {alertLevel === 'isolation-required'
            ? t('topology.isolationRequired')
            : t('topology.activeThreatReviewRequired')}
        </p>
      )}

      <div className="mt-3">
        {primaryIncident ? (
          <button
            onClick={() => onOpenIncident(primaryIncident.id)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-left hover:border-white/20"
          >
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Active incident
            </p>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-slate-200">{primaryIncident.title}</span>
              <SeverityBadge severity={primaryIncident.severity} />
            </div>
          </button>
        ) : (
          <p className="text-[11px] text-slate-500">{t('topology.noActiveIncidentToIsolate')}</p>
        )}
      </div>

      {canIsolate && (
        <Button
          variant="danger-solid"
          size="sm"
          className="mt-3 w-full"
          onClick={() => primaryIncident && onRequestIsolate(primaryIncident.id)}
        >
          <ShieldAlert className="h-3.5 w-3.5" />
          {t('topology.isolateDevice')}
        </Button>
      )}
    </Card>
  );
}

import {
  AlertTriangle,
  GitBranch,
  Laptop2,
  Maximize,
  Minimize,
  Radio,
  ShieldCheck,
  Ticket,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { AlertsFeed } from '../../components/widgets/AlertsFeed';
import { AttackPathGraph } from '../../components/widgets/AttackPathGraph';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { IncidentInvestigationPanel } from '../../components/widgets/IncidentInvestigationPanel';
import { StaleDataBanner } from '../../components/widgets/StaleDataBanner';
import { ThreatTopology } from '../../components/widgets/ThreatTopology';
import { ATTACK_CHAINS } from '../../citadel/attackChains.data';
import { useDepartments } from '../../hooks/useDepartments';
import { useDevices } from '../../hooks/useDevices';
import { useFullscreen } from '../../hooks/useFullscreen';
import { useAcknowledgeIncident, useIncidents } from '../../hooks/useIncidents';
import { useTickets } from '../../hooks/useTickets';
import { computeOrgSecurityScore } from '../../lib/scoring';
import { DevicePanel } from './DevicePanel';
import { EndpointGrid } from './EndpointGrid';

type RightPanelTab = 'feed' | 'endpoints';

type ViewMode = 'live' | 'attack-path';

export function CitadelLiveViewPage() {
  const { data: departments = [], isError: departmentsError } = useDepartments();
  const { data: devices = [], isError: devicesError } = useDevices();
  const { data: incidents = [], isError: incidentsError } = useIncidents();
  const { data: tickets = [] } = useTickets();
  const connectionLost = departmentsError || devicesError || incidentsError;
  const acknowledgeIncident = useAcknowledgeIncident();
  const { isFullscreen, toggle } = useFullscreen();
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('feed');
  const [viewMode, setViewMode] = useState<ViewMode>('live');
  const [chainId, setChainId] = useState(ATTACK_CHAINS[0].id);
  const chain = ATTACK_CHAINS.find((c) => c.id === chainId) ?? ATTACK_CHAINS[0];

  const orgScore = useMemo(() => computeOrgSecurityScore(incidents), [incidents]);
  const openIncidents = incidents.filter((incident) => incident.status === 'open').length;
  const openTickets = tickets.filter(
    (ticket) => ticket.status === 'open' || ticket.status === 'in-progress',
  ).length;

  return (
    <div className="-m-6 flex h-[calc(100vh-3.5rem)] flex-col gap-4 bg-mirqab-primary p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-wide text-white">
            THE CITADEL — {viewMode === 'live' ? 'LIVE VIEW' : 'ATTACK PATH'}
          </h1>
          <p className="text-xs text-slate-500">
            {viewMode === 'live'
              ? 'Real-time SOC wall display — every incident shown is a real database record, from whichever source produced it (see each incident\'s provenance badge)'
              : 'Static reference attack chains, not live case data — real MITRE ATT&CK Evaluations data and a mock CTF scenario, switchable below'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-white/10 bg-white/5 p-0.5">
            <Button
              variant={viewMode === 'live' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setViewMode('live')}
            >
              <Radio className="h-4 w-4" /> Live View
            </Button>
            <Button
              variant={viewMode === 'attack-path' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setViewMode('attack-path')}
            >
              <GitBranch className="h-4 w-4" /> Attack Path
            </Button>
          </div>
          <Button variant="secondary" onClick={toggle}>
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          </Button>
        </div>
      </div>

      {viewMode === 'live' ? (
        <>
          <StaleDataBanner show={Boolean(connectionLost)} />
          <div className="grid grid-cols-4 gap-4">
            <BigStat
              icon={ShieldCheck}
              label="Org score"
              value={String(orgScore)}
              tone={orgScore >= 80 ? 'success' : orgScore >= 50 ? 'warning' : 'danger'}
            />
            <BigStat
              icon={AlertTriangle}
              label="Unacked alerts"
              value={String(incidents.filter((a) => !a.acknowledged).length)}
              tone="warning"
            />
            <BigStat
              icon={Ticket}
              label="Open incidents/tickets"
              value={`${openIncidents} / ${openTickets}`}
              tone="neutral"
            />
            <BigStat
              icon={Laptop2}
              label="Devices monitored"
              value={String(devices.length)}
              tone="neutral"
            />
          </div>

          <div className="grid flex-1 grid-cols-4 gap-4 overflow-hidden">
            <div className="col-span-3 overflow-hidden rounded-2xl border border-white/10">
              <ThreatTopology
                departments={departments}
                devices={devices}
                alerts={incidents}
                height="100%"
                onOpenIncident={(incidentId) => setSelectedIncidentId(incidentId)}
              />
            </div>
            <div className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-3 flex items-center gap-1 rounded-lg border border-white/10 bg-mirqab-black/20 p-0.5">
                <button
                  onClick={() => setRightPanelTab('feed')}
                  className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
                    rightPanelTab === 'feed'
                      ? 'bg-mirqab-accent/20 text-mirqab-accent'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Live feed
                </button>
                <button
                  onClick={() => setRightPanelTab('endpoints')}
                  className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
                    rightPanelTab === 'endpoints'
                      ? 'bg-mirqab-accent/20 text-mirqab-accent'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Endpoints ({devices.length})
                </button>
              </div>
              <div className="overflow-y-auto">
                {rightPanelTab === 'feed' ? (
                  <AlertsFeed
                    alerts={incidents}
                    departments={departments}
                    devices={devices}
                    limit={30}
                    onAcknowledge={(id) => acknowledgeIncident.mutate(id)}
                    onSelect={(incidentId) => setSelectedIncidentId(incidentId)}
                  />
                ) : (
                  <EndpointGrid
                    devices={devices}
                    selectedDeviceId={selectedDeviceId}
                    onSelect={(deviceId) => setSelectedDeviceId(deviceId)}
                  />
                )}
              </div>
            </div>
          </div>

          {selectedDeviceId && (
            <DevicePanel
              key={selectedDeviceId}
              device={devices.find((d) => d.id === selectedDeviceId) ?? null}
              incidents={incidents}
              onClose={() => setSelectedDeviceId(null)}
              onOpenIncident={(incidentId) => setSelectedIncidentId(incidentId)}
            />
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-3">
            {ATTACK_CHAINS.map((c) => (
              <button
                key={c.id}
                onClick={() => setChainId(c.id)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  c.id === chainId
                    ? 'border-mirqab-accent bg-mirqab-accent/15 text-mirqab-accent'
                    : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                }`}
              >
                {c.name}
                <Badge status={c.provenance === 'real' ? 'success' : 'unknown'}>
                  {c.provenance === 'real' ? 'Real data' : 'Mock'}
                </Badge>
              </button>
            ))}
          </div>

          <div className="grid flex-1 grid-cols-4 gap-4 overflow-hidden">
            <div className="col-span-3 flex flex-col gap-3 overflow-hidden">
              <AttackPathGraph chain={chain} height="100%" />
            </div>
            <div className="overflow-y-auto rounded-2xl border border-white/10 bg-white/5 p-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Timeline
              </h3>
              <p className="mb-3 text-[11px] text-slate-500">{chain.sourceLabel}</p>
              <ol className="space-y-3">
                {chain.steps.map((step) => (
                  <li
                    key={step.step}
                    className="rounded-lg border border-white/5 bg-mirqab-black/20 p-2.5"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-mirqab-accent">
                        {step.step} — {step.stage}
                      </span>
                    </div>
                    <p className="mb-1.5 text-xs text-slate-300">{step.description}</p>
                    <div className="flex flex-wrap gap-1">
                      {step.techniques.map((technique) => (
                        <span
                          key={technique}
                          className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400"
                        >
                          {technique}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </>
      )}

      <IncidentInvestigationPanel
        incidentId={selectedIncidentId}
        departments={departments}
        devices={devices}
        onClose={() => setSelectedIncidentId(null)}
      />
    </div>
  );
}

function BigStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}) {
  const toneClass = {
    success: 'text-mirqab-success',
    warning: 'text-mirqab-warning',
    danger: 'text-mirqab-danger',
    neutral: 'text-mirqab-accent',
  }[tone];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className={`mb-2 flex items-center gap-2 ${toneClass}`}>
        <Icon className="h-4 w-4" />
        <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
      </div>
      <p className="text-3xl font-bold text-white">{value}</p>
    </div>
  );
}

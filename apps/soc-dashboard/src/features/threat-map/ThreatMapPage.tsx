import { useMemo, useState } from 'react';
import { SeverityBadge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { IncidentInvestigationPanel } from '../../components/widgets/IncidentInvestigationPanel';
import { StaleDataBanner } from '../../components/widgets/StaleDataBanner';
import { ThreatTopology } from '../../components/widgets/ThreatTopology';
import { DeviceInteractionPanel } from './DeviceInteractionPanel';
import { DepartmentPanel } from './DepartmentPanel';
import { useDepartments } from '../../hooks/useDepartments';
import { useDevices } from '../../hooks/useDevices';
import { useIncidents } from '../../hooks/useIncidents';
import { computeDepartmentStats } from '../../lib/departmentStats';
import type { Severity } from '../../types/domain';

const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];

export function ThreatMapPage() {
  const { data: departments = [], isError: departmentsError } = useDepartments();
  const { data: devices = [], isError: devicesError } = useDevices();
  const { data: incidents = [], isError: incidentsError } = useIncidents();
  const connectionLost = departmentsError || devicesError || incidentsError;

  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null);
  // Set only when isolation was requested from the Digital Twin — the
  // Incident Response panel then opens straight to its own real
  // confirm-isolation step (existing IncidentInvestigationPanel behavior)
  // instead of the analyst having to find and click into it separately.
  const [autoOpenIsolateConfirm, setAutoOpenIsolateConfirm] = useState(false);

  // Client-side only — narrows what the map DISPLAYS, never the real data
  // the detail drawers show (those always read the full, unfiltered
  // devices/incidents so a filtered-out entity still opens correctly).
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState<Severity | ''>('');
  const [isolatedOnly, setIsolatedOnly] = useState(false);

  const mapDepartments = useMemo(
    () => (departmentFilter ? departments.filter((dept) => dept.id === departmentFilter) : departments),
    [departments, departmentFilter],
  );
  const mapDevices = useMemo(
    () =>
      devices.filter(
        (device) =>
          (!departmentFilter || device.departmentId === departmentFilter) &&
          (!isolatedOnly || device.isolated),
      ),
    [devices, departmentFilter, isolatedOnly],
  );
  const mapIncidents = useMemo(
    () =>
      incidents.filter(
        (incident) =>
          (!departmentFilter || incident.departmentId === departmentFilter) &&
          (!severityFilter || incident.severity === severityFilter),
      ),
    [incidents, departmentFilter, severityFilter],
  );

  const stats = useMemo(
    () => computeDepartmentStats(mapDepartments, mapDevices, mapIncidents),
    [mapDepartments, mapDevices, mapIncidents],
  );
  const activeDepartments = stats.filter((dept) => dept.worstSeverity);

  const selectedDevice = devices.find((device) => device.id === selectedDeviceId) ?? null;
  const selectedDeviceDepartmentName =
    departments.find((dept) => dept.id === selectedDevice?.departmentId)?.name ??
    'Unknown department';

  function openDevice(deviceId: string) {
    setSelectedDepartmentId(null);
    setSelectedDeviceId(deviceId);
  }
  function openDepartment(departmentId: string) {
    setSelectedDeviceId(null);
    setSelectedDepartmentId(departmentId);
  }
  function openIncident(incidentId: string) {
    setAutoOpenIsolateConfirm(false);
    setSelectedIncidentId(incidentId);
  }
  /** "عزل الجهاز" from the Digital Twin never isolates directly — it opens
   * the real Incident Response panel over the map, landing straight on
   * the existing isolate-confirmation step, so the analyst reviews the
   * incident before the real backend mutation runs. */
  function requestIsolateViaIncidentPanel(incidentId: string) {
    setAutoOpenIsolateConfirm(true);
    setSelectedIncidentId(incidentId);
  }

  return (
    <div className="space-y-4">
      <StaleDataBanner show={Boolean(connectionLost)} />
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Network topology</h2>
            <p className="text-xs text-slate-500">
              Click a department or device to open its details. Pan and zoom the canvas freely —
              the dashed nodes at the top (Internet/Firewall/Core Switch/App/DB Server) are
              reference orientation only, not live monitored infrastructure.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={departmentFilter}
              onChange={(event) => setDepartmentFilter(event.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200"
            >
              {/* The browser renders this dropdown's own popup list with its
                  native (light) background regardless of the app theme above —
                  text-slate-200 on the <select> only affects the closed control.
                  Options need their own explicit dark color (text-[#0f172a], not
                  the theme-reactive text-slate-900, since this must stay dark
                  even in light mode too) or they become unreadable. */}
              <option value="" className="text-[#0f172a]">
                All departments
              </option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id} className="text-[#0f172a]">
                  {dept.name}
                </option>
              ))}
            </select>
            <select
              value={severityFilter}
              onChange={(event) => setSeverityFilter(event.target.value as Severity | '')}
              className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200"
            >
              <option value="" className="text-[#0f172a]">
                All severities
              </option>
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity} className="text-[#0f172a]">
                  {severity}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={isolatedOnly}
                onChange={(event) => setIsolatedOnly(event.target.checked)}
                className="accent-mirqab-accent"
              />
              Isolated only
            </label>
          </div>
        </div>
        <ThreatTopology
          departments={mapDepartments}
          devices={mapDevices}
          alerts={mapIncidents}
          height={520}
          onOpenIncident={(incidentId) => openIncident(incidentId)}
          onSelectDevice={openDevice}
          onSelectDepartment={openDepartment}
        />
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-white">Departments under active threat</h3>
        {activeDepartments.length === 0 ? (
          <p className="text-sm text-mirqab-success">No active threats detected right now.</p>
        ) : (
          <ul className="space-y-2">
            {activeDepartments.map((dept) => (
              <li key={dept.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-300">{dept.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">{dept.openAlerts} open alerts</span>
                  {dept.worstSeverity && <SeverityBadge severity={dept.worstSeverity} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {selectedDeviceId && (
        <div className="fixed inset-y-4 start-4 z-30 w-full max-w-xs">
          <DeviceInteractionPanel
            key={selectedDeviceId}
            device={selectedDevice}
            departmentName={selectedDeviceDepartmentName}
            incidents={incidents}
            onClose={() => setSelectedDeviceId(null)}
            onOpenIncident={(incidentId) => openIncident(incidentId)}
            onRequestIsolate={requestIsolateViaIncidentPanel}
          />
        </div>
      )}

      <DepartmentPanel
        department={departments.find((dept) => dept.id === selectedDepartmentId) ?? null}
        devices={devices}
        incidents={incidents}
        onClose={() => setSelectedDepartmentId(null)}
        onSelectDevice={openDevice}
        onSelectIncident={(incidentId) => openIncident(incidentId)}
      />

      <IncidentInvestigationPanel
        incidentId={selectedIncidentId}
        departments={departments}
        devices={devices}
        onClose={() => {
          setSelectedIncidentId(null);
          setAutoOpenIsolateConfirm(false);
        }}
        autoOpenIsolateConfirm={autoOpenIsolateConfirm}
      />
    </div>
  );
}

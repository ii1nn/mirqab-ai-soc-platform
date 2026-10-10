import { useMemo, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { SEVERITY_COLOR, SeverityBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { IncidentInvestigationPanel } from '../../components/widgets/IncidentInvestigationPanel';
import { useDepartments } from '../../hooks/useDepartments';
import { useDevices } from '../../hooks/useDevices';
import { useAcknowledgeIncident, useIncidents } from '../../hooks/useIncidents';
import { formatDateTime } from '../../lib/format';
import type { Severity } from '../../types/domain';

const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];

export function LiveAlertsPage() {
  const { data: incidents = [], isLoading, isError, refetch } = useIncidents();
  const { data: departments = [] } = useDepartments();
  const { data: devices = [] } = useDevices();
  // Explicit acknowledgement — stops the backend's 5-minute automated
  // containment (POST /ai/incidents/:id/acknowledge).
  const acknowledgeIncident = useAcknowledgeIncident();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeSeverities, setActiveSeverities] = useState<Severity[]>(SEVERITIES);
  const [search, setSearch] = useState('');
  // `?incidentId=` deep link (used by response-window notifications) opens
  // that incident's investigation panel directly.
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(
    () => searchParams.get('incidentId'),
  );

  const departmentFilter = searchParams.get('departmentId') ?? '';
  const deviceFilter = searchParams.get('deviceId') ?? '';

  function departmentName(id: string | null): string {
    return departments.find((dept) => dept.id === id)?.name ?? 'Unknown department';
  }

  function deviceHostname(id: string | null): string {
    return devices.find((device) => device.id === id)?.hostname ?? 'Unknown device';
  }

  function toggleSeverity(severity: Severity) {
    setActiveSeverities((prev) =>
      prev.includes(severity) ? prev.filter((s) => s !== severity) : [...prev, severity],
    );
  }

  const filtered = useMemo(() => {
    // An exact Case ID is an unambiguous request for one specific incident —
    // it must always be findable regardless of severity toggles or a
    // leftover department/device filter still sitting in the URL (e.g. from
    // a "View alerts" link elsewhere in the app). Those other filters are
    // for browsing; a precise case ID search overrides them rather than
    // silently combining with them.
    const trimmedSearch = search.trim().toLowerCase();
    const exactCaseIdMatch = trimmedSearch
      ? incidents.find((alert) => alert.caseId.toLowerCase() === trimmedSearch)
      : undefined;
    if (exactCaseIdMatch) return [exactCaseIdMatch];

    return incidents.filter((alert) => {
      if (!activeSeverities.includes(alert.severity)) return false;
      if (departmentFilter && alert.departmentId !== departmentFilter) return false;
      if (deviceFilter && alert.deviceId !== deviceFilter) return false;
      if (
        search &&
        !alert.title.toLowerCase().includes(search.toLowerCase()) &&
        !alert.caseId.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      return true;
    });
  }, [incidents, activeSeverities, departmentFilter, deviceFilter, search]);

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {SEVERITIES.map((severity) => (
            <button
              key={severity}
              onClick={() => toggleSeverity(severity)}
              className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition ${
                activeSeverities.includes(severity)
                  ? 'border-mirqab-accent/40 bg-mirqab-accent/10 text-mirqab-accent'
                  : 'border-white/10 text-slate-500 hover:text-slate-300'
              }`}
            >
              {severity}
            </button>
          ))}
        </div>

        <select
          value={departmentFilter}
          onChange={(event) => {
            const params = new URLSearchParams(searchParams);
            if (event.target.value) params.set('departmentId', event.target.value);
            else params.delete('departmentId');
            setSearchParams(params);
          }}
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

        {deviceFilter && (
          <Button
            variant="secondary"
            className="px-2.5 py-1 text-xs"
            onClick={() => setSearchParams({})}
          >
            Clear device filter ({deviceHostname(deviceFilter)})
          </Button>
        )}

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by title or case ID (e.g. INC-20260826-0001)…"
          className="ml-auto w-56 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-mirqab-accent/50"
        />
      </Card>

      {isLoading ? (
        <Card>
          <LoadingState label="Loading alerts…" />
        </Card>
      ) : isError ? (
        <ErrorState
          description="Couldn't load incidents from the backend."
          action={
            <button
              onClick={() => refetch()}
              className="text-xs font-medium text-mirqab-accent hover:underline"
            >
              Retry
            </button>
          }
        />
      ) : (
      <Card>
        {filtered.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="No alerts match the current filters"
            description="Start Simulation Mode from the topbar if the list is empty."
          />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Case ID</Th>
                <Th>Alert</Th>
                <Th>Device</Th>
                <Th>Department</Th>
                <Th>MITRE technique</Th>
                <Th>Severity</Th>
                <Th>Detected</Th>
                <Th>Status</Th>
              </Tr>
            </Thead>
            <Tbody>
              {filtered.map((alert) => (
                <Tr
                  key={alert.id}
                  onClick={() => setSelectedIncidentId(alert.id)}
                  style={{ borderInlineStartColor: SEVERITY_COLOR[alert.severity] }}
                  className="cursor-pointer border-s-4 border-transparent hover:bg-white/5"
                >
                  <Td className="whitespace-nowrap text-xs text-slate-400">{alert.caseId}</Td>
                  <Td className="text-slate-200">
                    {alert.title}
                    <p className="text-xs text-slate-500">{alert.description}</p>
                  </Td>
                  <Td className="text-slate-400">{deviceHostname(alert.deviceId)}</Td>
                  <Td className="text-slate-400">{departmentName(alert.departmentId)}</Td>
                  <Td className="text-slate-400">
                    {alert.technique.id} · {alert.technique.name}
                  </Td>
                  <Td>
                    <SeverityBadge severity={alert.severity} />
                  </Td>
                  <Td className="text-slate-500">{formatDateTime(alert.createdAt)}</Td>
                  <Td>
                    {alert.acknowledged ? (
                      <span className="text-xs text-slate-500">Acknowledged</span>
                    ) : (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          acknowledgeIncident.mutate(alert.id);
                        }}
                        className="text-xs text-mirqab-accent hover:underline"
                      >
                        Acknowledge
                      </button>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>
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

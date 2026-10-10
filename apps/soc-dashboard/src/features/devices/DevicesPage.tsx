import { Laptop2, Radio } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { ScoreBar } from '../../components/ui/ScoreBar';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useDepartments } from '../../hooks/useDepartments';
import { useDevices, useSimulateAttack } from '../../hooks/useDevices';

export function DevicesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const departmentFilter = searchParams.get('departmentId') ?? '';

  const { data: departments = [] } = useDepartments();
  const {
    data: devices = [],
    isLoading,
    isError,
    refetch,
  } = useDevices(departmentFilter || undefined);
  const simulateAttack = useSimulateAttack();

  function departmentName(id: string): string {
    return departments.find((dept) => dept.id === id)?.name ?? 'Unknown department';
  }

  return (
    <div className="space-y-4">
      <Card className="flex items-center gap-3">
        <select
          value={departmentFilter}
          onChange={(event) => {
            if (event.target.value) setSearchParams({ departmentId: event.target.value });
            else setSearchParams({});
          }}
          className="rounded-lg border border-mirqab-border bg-white/5 px-2 py-1.5 text-xs text-slate-200"
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
        <p className="text-xs text-slate-500">{devices.length} virtual devices</p>
      </Card>

      {isLoading ? (
        <Card>
          <LoadingState label="Loading devices…" />
        </Card>
      ) : isError ? (
        <ErrorState
          description="Couldn't load the device inventory from the backend."
          action={
            <button
              onClick={() => refetch()}
              className="text-xs font-medium text-mirqab-accent hover:underline"
            >
              Retry
            </button>
          }
        />
      ) : devices.length === 0 ? (
        <Card>
          <EmptyState
            icon={Laptop2}
            title="No devices found"
            description={
              departmentFilter
                ? 'No devices are registered in this department.'
                : 'No devices are registered yet.'
            }
          />
        </Card>
      ) : (
      <Card>
        <Table>
          <Thead>
            <Tr>
              <Th>Hostname</Th>
              <Th>Department</Th>
              <Th>OS</Th>
              <Th>IP address</Th>
              <Th>Status</Th>
              <Th>Security score</Th>
              <Th />
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {devices.map((device) => (
              <Tr key={device.id}>
                <Td className="font-medium text-slate-200">{device.hostname}</Td>
                <Td className="text-slate-400">{departmentName(device.departmentId)}</Td>
                <Td className="text-slate-400">{device.os}</Td>
                <Td className="text-slate-500">{device.ipAddress}</Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    <Badge status={device.status === 'at-risk' ? 'danger' : 'success'}>
                      {device.status === 'at-risk'
                        ? `At risk (${device.activeIncidentCount})`
                        : 'Online'}
                    </Badge>
                    {/* Real Device.isolated (see DevicesService.withComputedStatus)
                        — only set once a confirmed ISOLATE_DEVICE action exists
                        for this exact endpoint, never a default/placeholder state. */}
                    {device.isolated && <Badge status="unknown">Isolated</Badge>}
                  </div>
                </Td>
                <Td className="w-40">
                  <div className="flex items-center gap-2">
                    <span className="w-8 text-xs text-slate-400">{device.currentScore}</span>
                    <ScoreBar value={device.currentScore} />
                  </div>
                </Td>
                <Td>
                  <button
                    onClick={() => navigate(`/alerts?deviceId=${device.id}`)}
                    className="text-xs text-mirqab-accent hover:underline"
                  >
                    View alerts
                  </button>
                </Td>
                <Td>
                  <button
                    onClick={() => simulateAttack.mutate(device)}
                    disabled={simulateAttack.isPending}
                    className="flex items-center gap-1 text-xs text-mirqab-danger hover:underline disabled:opacity-50"
                    title="Post one synthetic attack against this exact device through the real AI triage pipeline"
                  >
                    <Radio className="h-3 w-3" />
                    {simulateAttack.isPending && simulateAttack.variables?.id === device.id
                      ? 'Simulating…'
                      : 'Simulate Attack'}
                  </button>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
        {simulateAttack.isError && (
          <p className="mt-3 text-xs text-mirqab-danger">
            Couldn't post the simulated attack — please try again.
          </p>
        )}
      </Card>
      )}
    </div>
  );
}

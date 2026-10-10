import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { SeverityBadge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { ScoreBar } from '../../components/ui/ScoreBar';
import { useDepartments } from '../../hooks/useDepartments';
import { useDevices } from '../../hooks/useDevices';
import { useIncidents } from '../../hooks/useIncidents';
import { computeDepartmentStats } from '../../lib/departmentStats';

export function DepartmentsPage() {
  const navigate = useNavigate();
  const { data: departments = [] } = useDepartments();
  const { data: devices = [] } = useDevices();
  const { data: incidents = [] } = useIncidents();
  const stats = useMemo(
    () => computeDepartmentStats(departments, devices, incidents),
    [departments, devices, incidents],
  );

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {stats.map((dept) => (
        <Card key={dept.id} className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">{dept.name}</h3>
            {dept.worstSeverity ? (
              <SeverityBadge severity={dept.worstSeverity} />
            ) : (
              <span className="text-xs text-mirqab-success">Stable</span>
            )}
          </div>

          <div className="text-xs text-slate-400">
            {dept.deviceCount} devices · {dept.openAlerts} open alerts
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>Avg. security score</span>
              <span>{dept.avgScore}</span>
            </div>
            <ScoreBar value={dept.avgScore} />
          </div>

          <div className="mt-auto flex gap-3 pt-2 text-xs">
            <button
              onClick={() => navigate(`/devices?departmentId=${dept.id}`)}
              className="text-mirqab-accent hover:underline"
            >
              View devices
            </button>
            <button
              onClick={() => navigate(`/alerts?departmentId=${dept.id}`)}
              className="text-mirqab-accent hover:underline"
            >
              View alerts
            </button>
          </div>
        </Card>
      ))}
    </div>
  );
}

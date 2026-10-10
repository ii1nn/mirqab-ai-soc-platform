import type { AlertRecord, Department, Severity, VirtualDevice } from '../types/domain';

export interface DepartmentStat {
  id: string;
  name: string;
  deviceCount: number;
  avgScore: number;
  openAlerts: number;
  worstSeverity: Severity | null;
}

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function computeDepartmentStats(
  departments: Department[],
  devices: VirtualDevice[],
  alerts: AlertRecord[],
): DepartmentStat[] {
  return departments.map((dept) => {
    const deptDevices = devices.filter((device) => device.departmentId === dept.id);
    const openAlerts = alerts.filter(
      (alert) => alert.departmentId === dept.id && !alert.acknowledged,
    );

    const worstSeverity = openAlerts.reduce<Severity | null>((worst, alert) => {
      if (!worst || SEVERITY_RANK[alert.severity] > SEVERITY_RANK[worst]) return alert.severity;
      return worst;
    }, null);

    return {
      id: dept.id,
      name: dept.name,
      deviceCount: deptDevices.length,
      avgScore: Math.round(
        deptDevices.reduce((sum, device) => sum + device.currentScore, 0) /
          (deptDevices.length || 1),
      ),
      openAlerts: openAlerts.length,
      worstSeverity,
    };
  });
}

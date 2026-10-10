import type { DeviceMetrics } from '../../../electron/ipc/device.ipc';
import type { SecurityScoreCheck, SecurityScoreResult } from '../../types/domain';

const DISK_HEADROOM_WARN_PERCENT = 15;
const DISK_HEADROOM_DANGER_PERCENT = 5;
const CPU_WARN_PERCENT = 85;

/**
 * Every input here comes from a real, locally-observed device signal
 * (Defender/firewall state, disk headroom, CPU load) — this is a
 * deterministic rubric, not simulated or randomized data.
 */
export function computeSecurityScore(metrics: DeviceMetrics): SecurityScoreResult {
  const checks: SecurityScoreCheck[] = [
    defenderCheck(metrics),
    firewallCheck(metrics),
    diskCheck(metrics),
    cpuCheck(metrics),
  ];

  const score = Math.round(
    (checks.reduce((sum, check) => sum + check.points, 0) /
      checks.reduce((sum, check) => sum + check.maxPoints, 0)) *
      100,
  );

  return { score, checks };
}

function defenderCheck(metrics: DeviceMetrics): SecurityScoreCheck {
  const maxPoints = 35;
  const { defender } = metrics;

  if (!defender.supported) {
    return {
      id: 'defender',
      label: 'Antivirus protection',
      status: 'unknown',
      points: maxPoints * 0.5,
      maxPoints,
      detail: 'Antivirus status could not be determined on this device.',
    };
  }

  const healthy = Boolean(defender.antivirusEnabled && defender.realTimeProtectionEnabled);
  return {
    id: 'defender',
    label: 'Antivirus protection',
    status: healthy ? 'success' : 'danger',
    points: healthy ? maxPoints : 0,
    maxPoints,
    detail: healthy
      ? 'Real-time protection is active.'
      : 'Real-time antivirus protection is disabled.',
  };
}

function firewallCheck(metrics: DeviceMetrics): SecurityScoreCheck {
  const maxPoints = 30;
  const { firewall } = metrics;

  if (!firewall.supported || firewall.profiles.length === 0) {
    return {
      id: 'firewall',
      label: 'Firewall',
      status: 'unknown',
      points: maxPoints * 0.5,
      maxPoints,
      detail: 'Firewall status could not be determined on this device.',
    };
  }

  const allEnabled = firewall.profiles.every((profile) => profile.enabled);
  return {
    id: 'firewall',
    label: 'Firewall',
    status: allEnabled ? 'success' : 'danger',
    points: allEnabled ? maxPoints : 0,
    maxPoints,
    detail: allEnabled
      ? 'All network profiles are protected by the firewall.'
      : `Disabled on: ${firewall.profiles
          .filter((profile) => !profile.enabled)
          .map((profile) => profile.name)
          .join(', ')}.`,
  };
}

function diskCheck(metrics: DeviceMetrics): SecurityScoreCheck {
  const maxPoints = 20;
  const { disks } = metrics;

  if (disks.length === 0) {
    return {
      id: 'disk',
      label: 'Disk headroom',
      status: 'unknown',
      points: maxPoints * 0.5,
      maxPoints,
      detail: 'Disk usage could not be determined on this device.',
    };
  }

  const worstFreePercent = disks.reduce((min, disk) => {
    const freePercent = (disk.freeBytes / disk.totalBytes) * 100;
    return Math.min(min, freePercent);
  }, 100);

  let status: SecurityScoreCheck['status'] = 'success';
  if (worstFreePercent < DISK_HEADROOM_DANGER_PERCENT) status = 'danger';
  else if (worstFreePercent < DISK_HEADROOM_WARN_PERCENT) status = 'warning';

  const points = status === 'success' ? maxPoints : status === 'warning' ? maxPoints * 0.5 : 0;

  return {
    id: 'disk',
    label: 'Disk headroom',
    status,
    points,
    maxPoints,
    detail: `Lowest free space across drives: ${worstFreePercent.toFixed(1)}%.`,
  };
}

function cpuCheck(metrics: DeviceMetrics): SecurityScoreCheck {
  const maxPoints = 15;
  const overloaded = metrics.cpuLoadPercent >= CPU_WARN_PERCENT;

  return {
    id: 'cpu',
    label: 'CPU load',
    status: overloaded ? 'warning' : 'success',
    points: overloaded ? maxPoints * 0.5 : maxPoints,
    maxPoints,
    detail: overloaded
      ? `CPU load is high (${metrics.cpuLoadPercent}%), which can mask malicious activity.`
      : `CPU load is normal (${metrics.cpuLoadPercent}%).`,
  };
}

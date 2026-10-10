import type { AlertRecord, Severity } from '../types/domain';

const PENALTY: Record<Severity, number> = { low: 1, medium: 3, high: 6, critical: 10 };

/** A real, deterministic score over unacknowledged alerts — not a random or fabricated number. */
export function computeOrgSecurityScore(alerts: AlertRecord[]): number {
  const penalty = alerts
    .filter((alert) => !alert.acknowledged)
    .reduce((sum, alert) => sum + PENALTY[alert.severity], 0);

  return Math.max(20, Math.min(100, 92 - penalty));
}

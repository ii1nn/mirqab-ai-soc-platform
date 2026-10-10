import type { IncidentRecord, SecurityScoreResult } from '../types/domain';

/**
 * MOCK DATA — sample entries showing severities this local-only agent
 * cannot observe by itself (they require server-side correlation). Remove
 * once the backend Incidents module exists and this can query it directly.
 */
const MOCK_INCIDENTS: IncidentRecord[] = [
  {
    id: 'mock-brute-force',
    title: 'Repeated failed sign-in attempts',
    severity: 'medium',
    detectedAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    source: 'mock',
    description: 'Sample incident — will be replaced by server-correlated brute-force detection.',
  },
  {
    id: 'mock-phishing',
    title: 'Suspicious link reported in email',
    severity: 'low',
    detectedAt: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
    source: 'mock',
    description: 'Sample incident — will be replaced by real phishing-detection telemetry.',
  },
];

function deriveLocalIncidents(result: SecurityScoreResult): IncidentRecord[] {
  return result.checks
    .filter((check) => check.status === 'danger')
    .map((check) => ({
      id: `local-${check.id}`,
      title: `${check.label} issue detected`,
      severity: 'high',
      detectedAt: new Date().toISOString(),
      source: 'local-detection',
      description: check.detail,
    }));
}

export function getIncidentHistory(scoreResult: SecurityScoreResult | null): IncidentRecord[] {
  const local = scoreResult ? deriveLocalIncidents(scoreResult) : [];
  return [...local, ...MOCK_INCIDENTS].sort(
    (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
  );
}

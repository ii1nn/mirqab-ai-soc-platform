export type SecurityStatus = 'success' | 'warning' | 'danger' | 'unknown';

export interface SecurityScoreCheck {
  id: string;
  label: string;
  status: SecurityStatus;
  points: number;
  maxPoints: number;
  detail: string;
}

export interface SecurityScoreResult {
  score: number;
  checks: SecurityScoreCheck[];
}

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface IncidentRecord {
  id: string;
  title: string;
  severity: IncidentSeverity;
  detectedAt: string;
  source: 'local-detection' | 'mock';
  description: string;
}

export interface RecommendedFix {
  id: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  settingKey?: string;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  severity: SecurityStatus;
}

export interface ScanFinding {
  id: string;
  label: string;
  severity: IncidentSeverity;
  isMock: boolean;
  detail: string;
}

export interface ScanResult {
  startedAt: string;
  completedAt: string;
  findings: ScanFinding[];
  source: 'backend-ai' | 'local-heuristic';
}

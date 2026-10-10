/**
 * Raw shapes returned by the NestJS backend (Prisma enums are UPPERCASE,
 * ticket status is underscored). Each `services/*.ts` file adapts these into
 * the lowercase/hyphenated shapes in `types/domain.ts` that the rest of the
 * app (carried over from Phase 4) already expects — keeping the adapter at
 * the service boundary meant almost no page/component code had to change
 * when the dashboard switched from Simulation Mode to this real API.
 */

export type BackendSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type BackendIncidentStatus = 'OPEN' | 'INVESTIGATING' | 'CONTAINED' | 'RESOLVED' | 'CLOSED';
export type BackendTicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type BackendDeviceStatus = 'ONLINE' | 'AT_RISK';

export type BackendIncidentActionType =
  | 'ISOLATE_DEVICE'
  | 'DISABLE_ACCOUNT'
  | 'BLOCK_IP'
  | 'BLOCK_HASH'
  | 'RESET_PASSWORD'
  | 'UPDATE_FIREWALL'
  | 'KILL_PROCESS'
  | 'REMOVE_MALWARE'
  | 'COLLECT_FORENSICS'
  | 'MONITOR_DEPARTMENT';

export type BackendIncidentActionOutcome = 'PENDING' | 'SUCCESS' | 'FAILED';

export type BackendActionApprovalStatus =
  'NOT_REQUIRED' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

export type BackendIndicatorCategory = 'IOC' | 'IOA';
export type BackendIndicatorType =
  | 'IP'
  | 'DOMAIN'
  | 'URL'
  | 'HASH'
  | 'EMAIL'
  | 'FILE_PATH'
  | 'REGISTRY_KEY'
  | 'MUTEX'
  | 'USER_ACCOUNT'
  | 'BEHAVIOR';

export interface BackendIndicator {
  id: string;
  category: BackendIndicatorCategory;
  type: BackendIndicatorType;
  value: string;
  description: string | null;
  subtype: string | null;
  mitreTechniqueId: string | null;
  confidence: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export type BackendPersistenceType =
  | 'SCHEDULED_TASK'
  | 'WINDOWS_SERVICE'
  | 'STARTUP_FOLDER'
  | 'REGISTRY_RUN_KEY'
  | 'WMI_SUBSCRIPTION'
  | 'LOGIN_SCRIPT'
  | 'CRON_JOB'
  | 'POWERSHELL_PROFILE'
  | 'ACCOUNT_CREDENTIAL_CHANGE'
  | 'OTHER';

export interface BackendPersistenceFinding {
  id: string;
  type: BackendPersistenceType;
  endpoint: string | null;
  userAccount: string | null;
  process: string | null;
  command: string | null;
  evidenceText: string;
  mitreTechniqueId: string;
  mitreTechniqueName: string;
  mitreTactic: string;
  confidence: number;
  risk: BackendSeverity;
  createdAt: string;
}

export type BackendAiAgentName =
  'INCIDENT_AGENT' | 'IOC_IOA_AGENT' | 'MITRE_RISK_AGENT' | 'RECOMMENDATION_AGENT';

export interface BackendAiAgentDecision {
  id: string;
  agent: BackendAiAgentName;
  action: string;
  generatedBy: string;
  confidence: number | null;
  evidenceRefs: string[];
  summary: string;
  createdAt: string;
}

export interface BackendSecurityTestResult {
  name: string;
  category: string;
  passed: boolean;
  detail: string;
}

export interface BackendSecurityTestReport {
  runAt: string;
  results: BackendSecurityTestResult[];
  summary: { total: number; passed: number; failed: number };
}

/** Requirement #38: metadata for a stored Weekly SOC Report — the PDF bytes
 * themselves are fetched separately via the download endpoint, never inlined here. */
export interface BackendWeeklyReportSummary {
  id: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  generatedBy: string;
  filename: string;
}

/** Week Selector: live (non-persisted) KPI summary for one Sunday-Saturday
 * period — distinct from BackendWeeklyReportSummary above, which is
 * metadata for a *generated PDF*. */
export interface BackendWeeklySummary {
  period: { periodStart: string; periodEnd: string };
  totalAlerts: number;
  acknowledgedAlerts: number;
  openIncidents: number;
  totalTickets: number;
  resolvedTickets: number;
  avgResolutionMinutes: number | null;
}

export interface BackendReportPeriod {
  periodStart: string;
  periodEnd: string;
}

export interface BackendDepartment {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackendDevice {
  id: string;
  hostname: string;
  departmentId: string;
  os: string;
  deviceType: string;
  ipAddress: string;
  baselineScore: number;
  status: BackendDeviceStatus;
  currentScore: number;
  activeIncidentCount: number;
  isolated: boolean;
  isolatedAt: string | null;
  isolatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackendIncident {
  id: string;
  caseId: string;
  title: string;
  description: string;
  severity: BackendSeverity;
  mitreTechniqueId: string;
  mitreTechniqueName: string;
  mitreTactic: string;
  departmentId: string | null;
  deviceId: string | null;
  sourceExcerpt: string;
  status: BackendIncidentStatus;
  generatedBy: 'claude' | 'rule-based-fallback';
  createdAt: string;
  updatedAt: string;
  tickets?: BackendTicket[];
  malwareFamily: string | null;
  sourceIp: string | null;
  sourceCountry: string | null;
  destinationAsset: string | null;
  iocs: string[];
  detectionRule: string | null;
  userAccount: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  rootCause: string | null;
  finalResolution: string | null;
  lessonsLearned: string | null;
}

export interface BackendIncidentAction {
  id: string;
  incidentId: string;
  type: BackendIncidentActionType;
  outcome: BackendIncidentActionOutcome;
  performedBy: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  approvalStatus: BackendActionApprovalStatus;
  requestedBy: string | null;
  approvedBy: string | null;
  rejectedReason: string | null;
}

export interface BackendComparisonDimension {
  key: string;
  label: string;
  weight: number;
  matchStrength: number;
  hasData: boolean;
  detail: string;
}

export interface BackendSimilarIncidentEntry {
  incident: BackendIncident;
  score: number;
  confidence: number;
  dimensions: BackendComparisonDimension[];
  timeline: {
    occurredAt: string;
    status: BackendIncidentStatus;
    durationMs: number | null;
    resolutionTimeMs: number | null;
    handledBy: string | null;
  };
  actions: BackendIncidentAction[];
}

export type BackendBusinessImpact = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface BackendRiskPrediction {
  lateralMovementProbability: number | null;
  estimatedSpreadTimeMs: number | null;
  estimatedAffectedDevices: number | null;
  businessImpact: BackendBusinessImpact;
  confidence: number;
  sampleSize: number;
}

export interface BackendResponseRecommendation {
  type: BackendIncidentActionType;
  successCount: number;
  totalAttempts: number;
  sampleSize: number;
  reason: string;
  sufficientData: boolean;
  confidencePercent: number;
  humanApprovalRequired: boolean;
  riskLevel: 'HIGH' | 'LOW';
}

/** Suggested Solutions panel's headline summary — the single best historical
 * match. Real data only: absent (null) rather than fabricated when there is
 * no comparable history. See AiService.getInvestigation's `topMatch`. */
export interface BackendTopMatch {
  incidentId: string;
  caseId: string;
  occurredAt: string;
  daysAgo: number;
  similarityPercent: number;
  successfulActions: BackendIncidentAction[];
}

export type BackendResponseWindowState =
  | 'NOT_APPLICABLE'
  | 'WAITING_RESPONSE'
  | 'ACKNOWLEDGED'
  | 'WINDOW_EXPIRED'
  | 'CONTAINMENT_PENDING'
  | 'CONTAINMENT_SUCCEEDED'
  | 'CONTAINMENT_FAILED';

export type BackendContainmentBlockReason =
  | 'SEVERITY_NOT_ELIGIBLE'
  | 'NOT_OPEN'
  | 'ACKNOWLEDGED'
  | 'NO_DEVICE'
  | 'NO_ORGANIZATION'
  | 'ALREADY_ATTEMPTED'
  | 'WINDOW_OPEN'
  | 'SIMULATED'
  | 'POLICY_DISABLED'
  | 'PROVIDER_UNAVAILABLE';

/** backend/src/modules/ai/response-sla/response-sla.util.ts ResponseView. */
export interface BackendResponseWindow {
  windowMs: number;
  applicable: boolean;
  state: BackendResponseWindowState;
  detectedAt: string;
  deadline: string | null;
  serverNow: string;
  remainingMs: number | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  respondedInMs: number | null;
  respondedWithinWindow: boolean | null;
  containment: {
    actionId: string;
    outcome: BackendIncidentActionOutcome;
    automated: boolean;
    performedBy: string;
    requestedAt: string;
    completedAt: string | null;
    detail: string | null;
  } | null;
  automatedContainment: {
    policyEnabled: boolean;
    providerAvailable: boolean;
    eligible: boolean;
    blockedReason: BackendContainmentBlockReason | null;
  };
}

/** backend NotificationsService NotificationView. */
export interface BackendNotification {
  id: string;
  kind: 'RESPONSE_REQUIRED' | 'CONTAINMENT_RESULT' | 'LEGACY';
  containmentResult: 'SUCCEEDED' | 'FAILED' | 'UNAVAILABLE' | 'POLICY_DISABLED' | null;
  audience: 'EMPLOYEE' | 'ANALYST';
  createdAt: string;
  fallbackTitle: string;
  fallbackBody: string;
  incident: {
    id: string;
    caseId: string;
    title: string;
    severity: BackendSeverity;
    deviceName: string | null;
    departmentName: string | null;
    detectedAt: string;
    responseDeadline: string;
    acknowledgedAt: string | null;
  };
}

export interface BackendNotificationList {
  serverNow: string;
  items: BackendNotification[];
}

export interface BackendAcknowledgeResult {
  alreadyAcknowledged: boolean;
  response: BackendResponseWindow;
}

export interface BackendIncidentInvestigation {
  similar: BackendSimilarIncidentEntry[];
  recommendations: BackendResponseRecommendation[];
  recommendationSource: 'deterministic';
  riskPrediction: BackendRiskPrediction;
  ownActions: BackendIncidentAction[];
  topMatch: BackendTopMatch | null;
}

export interface BackendTicket {
  id: string;
  ticketNumber: number;
  incidentId: string;
  title: string;
  status: BackendTicketStatus;
  severity: BackendSeverity;
  assignee: string | null;
  departmentId: string | null;
  deviceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackendPolicy {
  id: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  compliancePercent: number;
  createdAt: string;
  updatedAt: string;
}

export interface BackendAuditLog {
  id: string;
  actorEmail: string;
  action: string;
  target: string | null;
  createdAt: string;
}

export interface BackendSimilarIncident {
  incident: BackendIncident;
  score: number;
}

export interface BackendAnalyzeResult {
  incident: BackendIncident;
  ticket: BackendTicket | null;
  recommendedFixes: string[];
}

export interface BackendResponseAction {
  id: string;
  actionType: string;
  title: string;
  description: string;
  executedAt: string | null;
  executedBy: string;
  status: 'pending' | 'completed' | 'failed';
  result: string | null;
  approvalStatus: BackendActionApprovalStatus;
}

export interface BackendTimelineEntry {
  id: string;
  timestamp: string;
  event: string;
  description?: string;
  performedBy?: string;
}

/** One raw event absorbed into a case — the founding event
 * (correlationScore null) plus each correlated merge after it. See
 * backend AiService.composeHistory. */
export type BackendEventSource = 'LIVE_AGENT' | 'OPEN_SOURCE_DATASET' | 'SIMULATION' | 'MANUAL_TEST';

export interface BackendIncidentEvidenceItem {
  id: string;
  sourceExcerpt: string;
  severity: BackendSeverity;
  mitreTechniqueId: string;
  mitreTechniqueName: string;
  correlationScore: number | null;
  createdAt: string;
  ingestSource: BackendEventSource;
  datasetOrigin: string | null;
  rawEvent: string | null;
}

export interface BackendIncidentHistory {
  id: string;
  caseId: string;
  ticketNumber: string | null;
  title: string;
  description: string;

  detectedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;

  response: BackendResponseWindow;

  departmentId: string | null;
  departmentName: string | null;

  deviceId: string | null;
  deviceName: string | null;
  deviceIp: string | null;
  deviceType: string | null;
  operatingSystem: string | null;

  attackType: string;
  attackCategory: string;
  mitreTechniqueId: string;
  mitreTechniqueName: string;

  severity: BackendSeverity;
  status: BackendIncidentStatus;

  indicatorsOfCompromise: string[];
  source: string | null;
  destination: string | null;
  userAccount: string | null;

  actionsTaken: BackendResponseAction[];
  timeline: BackendTimelineEntry[];
  evidenceCount: number;
  evidence: BackendIncidentEvidenceItem[];

  ingestSource: BackendEventSource;
  datasetOrigin: string | null;
  rawEvent: string | null;

  isolated: boolean;
  isolatedAt: string | null;
  isolatedBy: string | null;

  rootCause: string | null;
  finalResolution: string | null;
  lessonsLearned: string | null;

  analystName: string | null;
  resolutionTimeMinutes: number | null;
  responseSuccessRate: number | null;
  recommendedFixes: string[];

  createdAt: string;
  updatedAt: string;
}

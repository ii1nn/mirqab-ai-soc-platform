export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type SecurityStatus = 'success' | 'info' | 'warning' | 'danger' | 'unknown';
export type DeviceStatus = 'online' | 'at-risk';
export type TicketStatus = 'open' | 'in-progress' | 'resolved' | 'closed';
export type IncidentStatus = 'open' | 'investigating' | 'contained' | 'resolved' | 'closed';

export interface MitreTechnique {
  id: string;
  name: string;
  tactic: string;
}

export interface Department {
  id: string;
  name: string;
}

export interface VirtualDevice {
  id: string;
  hostname: string;
  departmentId: string;
  os: string;
  deviceType: string;
  ipAddress: string;
  baselineScore: number;
  status: DeviceStatus;
  currentScore: number;
  activeIncidentCount: number;
  isolated: boolean;
  isolatedAt: string | null;
  isolatedBy: string | null;
}

/**
 * The real backend `Incident` (every classified event, any severity — not
 * just escalated ones), adapted to the shape Phase 4's UI already used.
 * `acknowledged` is derived (`status !== 'open'`) so scoring/filtering code
 * written against the old client-side AlertRecord needed no changes.
 */
export interface AlertRecord {
  id: string;
  caseId: string;
  title: string;
  description: string;
  severity: Severity;
  technique: MitreTechnique;
  departmentId: string | null;
  deviceId: string | null;
  createdAt: string;
  updatedAt: string;
  status: IncidentStatus;
  acknowledged: boolean;
  generatedBy: 'claude' | 'rule-based-fallback';
  /**
   * Real, regex/keyword-extracted from the incident's source excerpt (see
   * backend/src/modules/ai/enrichment) — null when the text didn't contain
   * that signal, never fabricated. Powers Similar Attack Analysis.
   */
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

export type IncidentActionType =
  | 'isolate-device'
  | 'disable-account'
  | 'block-ip'
  | 'block-hash'
  | 'reset-password'
  | 'update-firewall'
  | 'kill-process'
  | 'remove-malware'
  | 'collect-forensics'
  | 'monitor-department';

export type IncidentActionOutcome = 'pending' | 'success' | 'failed';

/** Requirement #6: an AI-recommended high-impact action starts
 * 'pending-approval' and can't have its outcome recorded until an analyst
 * explicitly approves it — see AiService.applyRecommended/approveIncidentAction. */
export type ActionApprovalStatus = 'not-required' | 'pending-approval' | 'approved' | 'rejected';

export interface IncidentAction {
  id: string;
  incidentId: string;
  type: IncidentActionType;
  outcome: IncidentActionOutcome;
  performedBy: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  approvalStatus: ActionApprovalStatus;
  requestedBy: string | null;
  approvedBy: string | null;
  rejectedReason: string | null;
}

/** Requirement #27/detection phase: real IOC (static artifact) / IOA
 * (behavioral pattern) findings — see backend modules/ai/detection. Empty
 * lists mean no signal was found in the evidence, never a fabricated one. */
export type IndicatorCategory = 'ioc' | 'ioa';
export type IndicatorType =
  | 'ip'
  | 'domain'
  | 'url'
  | 'hash'
  | 'email'
  | 'file-path'
  | 'registry-key'
  | 'mutex'
  | 'user-account'
  | 'behavior';

export interface Indicator {
  id: string;
  category: IndicatorCategory;
  type: IndicatorType;
  value: string;
  description: string | null;
  /** Free-text refinement (e.g. 'credential-dumping', 'c2-framework') — see backend detection/*.util.ts. */
  subtype: string | null;
  mitreTechniqueId: string | null;
  confidence: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export type PersistenceType =
  | 'scheduled-task'
  | 'windows-service'
  | 'startup-folder'
  | 'registry-run-key'
  | 'wmi-subscription'
  | 'login-script'
  | 'cron-job'
  | 'powershell-profile'
  | 'account-credential-change'
  | 'other';

export interface PersistenceFinding {
  id: string;
  type: PersistenceType;
  endpoint: string | null;
  userAccount: string | null;
  process: string | null;
  command: string | null;
  evidenceText: string;
  mitreTechniqueId: string;
  mitreTechniqueName: string;
  mitreTactic: string;
  confidence: number;
  risk: Severity;
  createdAt: string;
}

export type AiAgentName =
  'incident-agent' | 'ioc-ioa-agent' | 'mitre-risk-agent' | 'recommendation-agent';

export interface AiAgentDecision {
  id: string;
  agent: AiAgentName;
  action: string;
  generatedBy: string;
  confidence: number | null;
  evidenceRefs: string[];
  summary: string;
  createdAt: string;
}

/** Requirement #32: Security Testing Mode result — a live, on-demand run of
 * Mirqab's own defensive code paths against safe synthetic fixtures, never
 * an offensive capability. ADMIN-only, see backend SecurityTestingService. */
export interface SecurityTestResult {
  name: string;
  category: string;
  passed: boolean;
  detail: string;
}

export interface SecurityTestReport {
  runAt: string;
  results: SecurityTestResult[];
  summary: { total: number; passed: number; failed: number };
}

/** Requirement #38: Weekly SOC Report history entry — metadata only, the PDF
 * is downloaded on demand via reportsService.downloadWeeklyReport. */
export interface WeeklyReportSummary {
  id: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  generatedBy: string;
  filename: string;
}

/** Week Selector: live (non-persisted) KPI summary for a Sunday-Saturday
 * reporting period — backs the Weekly SOC Summary card. Distinct from
 * WeeklyReportSummary above, which is metadata for a *generated PDF*. */
export interface WeeklySummary {
  periodStart: string;
  periodEnd: string;
  totalAlerts: number;
  acknowledgedAlerts: number;
  openIncidents: number;
  totalTickets: number;
  resolvedTickets: number;
  avgResolutionMinutes: number | null;
}

/** One selectable Sunday-Saturday period in the Week Selector's list. */
export interface ReportWeek {
  periodStart: string;
  periodEnd: string;
}

export interface ComparisonDimension {
  key: string;
  label: string;
  weight: number;
  matchStrength: number;
  hasData: boolean;
  detail: string;
}

export interface SimilarIncidentEntry {
  incident: AlertRecord;
  score: number;
  confidence: number;
  dimensions: ComparisonDimension[];
  timeline: {
    occurredAt: string;
    status: IncidentStatus;
    durationMs: number | null;
    resolutionTimeMs: number | null;
    handledBy: string | null;
  };
  actions: IncidentAction[];
}

export type BusinessImpact = 'low' | 'medium' | 'high' | 'critical';

export interface RiskPrediction {
  lateralMovementProbability: number | null;
  estimatedSpreadTimeMs: number | null;
  estimatedAffectedDevices: number | null;
  businessImpact: BusinessImpact;
  confidence: number;
  sampleSize: number;
}

export interface ResponseRecommendation {
  type: IncidentActionType;
  successCount: number;
  totalAttempts: number;
  sampleSize: number;
  reason: string;
  /** false → the UI must show "insufficient historical data", never a
   * percentage that implies more certainty than the sample supports. */
  sufficientData: boolean;
  confidencePercent: number;
  humanApprovalRequired: boolean;
  riskLevel: 'high' | 'low';
}

/** Suggested Solutions panel's headline summary — the single best historical
 * match. Real data only: null (never a fabricated 0%/date) when there is no
 * comparable history — see AiService.getInvestigation's `topMatch`. */
export interface TopMatch {
  incidentId: string;
  caseId: string;
  occurredAt: string;
  daysAgo: number;
  similarityPercent: number;
  successfulActions: IncidentAction[];
}

/** Backend-derived state of the 5-minute response window — see backend
 * ResponseSlaService. */
export type ResponseWindowState =
  | 'not-applicable'
  | 'waiting-response'
  | 'acknowledged'
  | 'window-expired'
  | 'containment-pending'
  | 'containment-succeeded'
  | 'containment-failed';

export type ContainmentBlockReason =
  | 'severity-not-eligible'
  | 'not-open'
  | 'acknowledged'
  | 'no-device'
  | 'no-organization'
  | 'already-attempted'
  | 'window-open'
  | 'simulated'
  | 'policy-disabled'
  | 'provider-unavailable';

/**
 * The authoritative 5-minute response window, exactly as the backend
 * computed it. The UI renders this and nothing else: it never computes a
 * deadline, and never decides containment eligibility. A client-side
 * countdown is only a visual rendering of `deadline`, corrected for clock
 * skew via `serverNow`.
 */
export interface ResponseWindow {
  windowMs: number;
  applicable: boolean;
  state: ResponseWindowState;
  detectedAt: string;
  deadline: string | null;
  serverNow: string;
  /** Backend-computed at `serverNow`. */
  remainingMs: number | null;
  /** Client-only: `Date.now()` when this object was received. The visual
   * countdown is remainingMs minus the time elapsed since then, so the
   * browser's own wall clock never enters the calculation. */
  receivedAt: number;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  respondedInMs: number | null;
  respondedWithinWindow: boolean | null;
  containment: {
    actionId: string;
    outcome: IncidentActionOutcome;
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
    blockedReason: ContainmentBlockReason | null;
  };
}

export type NotificationKind = 'response-required' | 'containment-result' | 'legacy';
export type ContainmentNotificationResult = 'succeeded' | 'failed' | 'unavailable' | 'policy-disabled';

/** A backend Notification row in structured, locale-neutral form — the UI
 * builds the English/Arabic text from these fields. `fallbackTitle`/
 * `fallbackBody` are only shown for LEGACY rows (free text written before
 * this workflow existed). */
export interface SocNotification {
  id: string;
  kind: NotificationKind;
  containmentResult: ContainmentNotificationResult | null;
  createdAt: string;
  /** Backend clock at fetch time, and the client receipt time — same
   * skew-free countdown technique as ResponseWindow.receivedAt. */
  serverNow: string;
  receivedAt: number;
  fallbackTitle: string;
  fallbackBody: string;
  incident: {
    id: string;
    caseId: string;
    title: string;
    severity: Severity;
    deviceName: string | null;
    departmentName: string | null;
    detectedAt: string;
    responseDeadline: string;
    acknowledgedAt: string | null;
  };
}

export interface IncidentInvestigation {
  similar: SimilarIncidentEntry[];
  recommendations: ResponseRecommendation[];
  /** Always 'deterministic' in this codebase today — no Claude/external AI
   * backs the recommendation engine — kept explicit so the UI never claims
   * "AI" for something rule-based. */
  recommendationSource: 'deterministic';
  riskPrediction: RiskPrediction;
  ownActions: IncidentAction[];
  topMatch: TopMatch | null;
}

export interface TicketRecord {
  id: string;
  ticketNumber: number;
  incidentId: string;
  title: string;
  status: TicketStatus;
  severity: Severity;
  assignee: string | null;
  departmentId: string | null;
  deviceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyRecord {
  id: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  compliancePercent: number;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorEmail: string;
  action: string;
  target?: string;
  timestamp: string;
}

export interface ResponseAction {
  id: string;
  actionType: string;
  title: string;
  description: string;
  executedAt: string | null;
  executedBy: string;
  status: 'pending' | 'completed' | 'failed';
  result: string | null;
  approvalStatus: ActionApprovalStatus;
}

export interface TimelineEntry {
  id: string;
  timestamp: string;
  event: string;
  description?: string;
  performedBy?: string;
}

/** Where an event/case actually came from — real open-source dataset replay,
 * a live vendor agent, synthetic Simulation Mode traffic, or an ad-hoc
 * manual/test call. Kept in the backend's own casing (not adapted to
 * kebab-case) since it's shown directly as a provenance label, not routed
 * through the translation table other enums use. */
export type EventIngestSource = 'LIVE_AGENT' | 'OPEN_SOURCE_DATASET' | 'SIMULATION' | 'MANUAL_TEST';

/** One raw event absorbed into a case — the founding event
 * (correlationScore null, i.e. how the attack started) plus each
 * correlated merge after it (the attack's progression). */
export interface EvidenceItem {
  id: string;
  sourceExcerpt: string;
  severity: Severity;
  mitreTechniqueId: string;
  mitreTechniqueName: string;
  correlationScore: number | null;
  createdAt: string;
  /** Provenance for this specific piece of evidence — see EventIngestSource. */
  ingestSource: EventIngestSource;
  datasetOrigin: string | null;
  /** The untouched original event text/JSON this evidence's sourceExcerpt was
   * normalized from — null when no caller supplied one. */
  rawEvent: string | null;
}

export interface IncidentHistoryRecord {
  id: string;
  caseId: string;
  ticketNumber: string | null;
  title: string;
  description: string;

  detectedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;

  /** Backend-authoritative 5-minute response window — see ResponseWindow. */
  response: ResponseWindow;

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

  severity: Severity;
  status: IncidentStatus;

  indicatorsOfCompromise: string[];
  source: string | null;
  destination: string | null;
  userAccount: string | null;

  actionsTaken: ResponseAction[];
  timeline: TimelineEntry[];
  evidenceCount: number;
  evidence: EvidenceItem[];

  /** Provenance of this case's founding event — see EventIngestSource. */
  ingestSource: EventIngestSource;
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

import type {
  AiAgentDecision,
  AlertRecord,
  ComparisonDimension,
  EvidenceItem,
  Indicator,
  IncidentAction,
  IncidentHistoryRecord,
  IncidentInvestigation,
  IncidentStatus,
  PersistenceFinding,
  ResponseAction,
  ResponseRecommendation,
  ResponseWindow,
  RiskPrediction,
  SimilarIncidentEntry,
  TimelineEntry,
  TopMatch,
} from '../types/domain';
import {
  fromBackendActionOutcome,
  fromBackendActionType,
  fromBackendAiAgentName,
  fromBackendApprovalStatus,
  fromBackendBusinessImpact,
  fromBackendIncidentStatus,
  fromBackendIndicatorCategory,
  fromBackendIndicatorType,
  fromBackendPersistenceType,
  fromBackendResponseWindow,
  fromBackendRiskLevel,
  fromBackendSeverity,
  toBackendActionOutcome,
  toBackendActionType,
  toBackendIncidentStatus,
} from './adapters';
import { apiClient } from './api-client';
import { downloadBlob } from '../lib/download';
import type {
  BackendAcknowledgeResult,
  BackendAiAgentDecision,
  BackendAnalyzeResult,
  BackendComparisonDimension,
  BackendIncident,
  BackendIncidentAction,
  BackendIncidentEvidenceItem,
  BackendIncidentHistory,
  BackendIncidentInvestigation,
  BackendIndicator,
  BackendPersistenceFinding,
  BackendResponseAction,
  BackendSimilarIncident,
  BackendSimilarIncidentEntry,
  BackendTimelineEntry,
  BackendTopMatch,
} from './backend-types';

function adapt(incident: BackendIncident): AlertRecord {
  const status = fromBackendIncidentStatus(incident.status);
  return {
    id: incident.id,
    caseId: incident.caseId,
    title: incident.title,
    description: incident.description,
    severity: fromBackendSeverity(incident.severity),
    technique: {
      id: incident.mitreTechniqueId,
      name: incident.mitreTechniqueName,
      tactic: incident.mitreTactic,
    },
    departmentId: incident.departmentId,
    deviceId: incident.deviceId,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
    status,
    acknowledged: status !== 'open',
    generatedBy: incident.generatedBy,
    malwareFamily: incident.malwareFamily,
    sourceIp: incident.sourceIp,
    sourceCountry: incident.sourceCountry,
    destinationAsset: incident.destinationAsset,
    iocs: incident.iocs,
    detectionRule: incident.detectionRule,
    userAccount: incident.userAccount,
    acknowledgedAt: incident.acknowledgedAt,
    resolvedAt: incident.resolvedAt,
    rootCause: incident.rootCause,
    finalResolution: incident.finalResolution,
    lessonsLearned: incident.lessonsLearned,
  };
}

function adaptResponseAction(action: BackendResponseAction): ResponseAction {
  return { ...action, approvalStatus: fromBackendApprovalStatus(action.approvalStatus) };
}

function adaptTimelineEntry(entry: BackendTimelineEntry): TimelineEntry {
  return { ...entry };
}

function adaptEvidenceItem(item: BackendIncidentEvidenceItem): EvidenceItem {
  return { ...item, severity: fromBackendSeverity(item.severity) };
}

function adaptHistory(history: BackendIncidentHistory): IncidentHistoryRecord {
  return {
    ...history,
    response: fromBackendResponseWindow(history.response),
    severity: fromBackendSeverity(history.severity),
    status: fromBackendIncidentStatus(history.status),
    actionsTaken: history.actionsTaken.map(adaptResponseAction),
    timeline: history.timeline.map(adaptTimelineEntry),
    evidence: history.evidence.map(adaptEvidenceItem),
  };
}

function adaptAction(action: BackendIncidentAction): IncidentAction {
  return {
    id: action.id,
    incidentId: action.incidentId,
    type: fromBackendActionType(action.type),
    outcome: fromBackendActionOutcome(action.outcome),
    performedBy: action.performedBy,
    notes: action.notes,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
    approvalStatus: fromBackendApprovalStatus(action.approvalStatus),
    requestedBy: action.requestedBy,
    approvedBy: action.approvedBy,
    rejectedReason: action.rejectedReason,
  };
}

function adaptDimension(dimension: BackendComparisonDimension): ComparisonDimension {
  return { ...dimension };
}

function adaptSimilarEntry(entry: BackendSimilarIncidentEntry): SimilarIncidentEntry {
  return {
    incident: adapt(entry.incident),
    score: entry.score,
    confidence: entry.confidence,
    dimensions: entry.dimensions.map(adaptDimension),
    timeline: {
      occurredAt: entry.timeline.occurredAt,
      status: fromBackendIncidentStatus(entry.timeline.status),
      durationMs: entry.timeline.durationMs,
      resolutionTimeMs: entry.timeline.resolutionTimeMs,
      handledBy: entry.timeline.handledBy,
    },
    actions: entry.actions.map(adaptAction),
  };
}

function adaptRiskPrediction(risk: BackendIncidentInvestigation['riskPrediction']): RiskPrediction {
  return {
    lateralMovementProbability: risk.lateralMovementProbability,
    estimatedSpreadTimeMs: risk.estimatedSpreadTimeMs,
    estimatedAffectedDevices: risk.estimatedAffectedDevices,
    businessImpact: fromBackendBusinessImpact(risk.businessImpact),
    confidence: risk.confidence,
    sampleSize: risk.sampleSize,
  };
}

function adaptRecommendation(
  rec: BackendIncidentInvestigation['recommendations'][number],
): ResponseRecommendation {
  return {
    type: fromBackendActionType(rec.type),
    successCount: rec.successCount,
    totalAttempts: rec.totalAttempts,
    sampleSize: rec.sampleSize,
    reason: rec.reason,
    sufficientData: rec.sufficientData,
    confidencePercent: rec.confidencePercent,
    humanApprovalRequired: rec.humanApprovalRequired,
    riskLevel: fromBackendRiskLevel(rec.riskLevel),
  };
}

function adaptTopMatch(topMatch: BackendTopMatch | null): TopMatch | null {
  if (!topMatch) return null;
  return {
    incidentId: topMatch.incidentId,
    caseId: topMatch.caseId,
    occurredAt: topMatch.occurredAt,
    daysAgo: topMatch.daysAgo,
    similarityPercent: topMatch.similarityPercent,
    successfulActions: topMatch.successfulActions.map(adaptAction),
  };
}

function adaptInvestigation(investigation: BackendIncidentInvestigation): IncidentInvestigation {
  return {
    similar: investigation.similar.map(adaptSimilarEntry),
    recommendations: investigation.recommendations.map(adaptRecommendation),
    recommendationSource: investigation.recommendationSource,
    riskPrediction: adaptRiskPrediction(investigation.riskPrediction),
    ownActions: investigation.ownActions.map(adaptAction),
    topMatch: adaptTopMatch(investigation.topMatch),
  };
}

function adaptIndicator(indicator: BackendIndicator): Indicator {
  return {
    id: indicator.id,
    category: fromBackendIndicatorCategory(indicator.category),
    type: fromBackendIndicatorType(indicator.type),
    value: indicator.value,
    description: indicator.description,
    subtype: indicator.subtype,
    mitreTechniqueId: indicator.mitreTechniqueId,
    confidence: indicator.confidence,
    firstSeenAt: indicator.firstSeenAt,
    lastSeenAt: indicator.lastSeenAt,
  };
}

function adaptPersistenceFinding(finding: BackendPersistenceFinding): PersistenceFinding {
  return {
    id: finding.id,
    type: fromBackendPersistenceType(finding.type),
    endpoint: finding.endpoint,
    userAccount: finding.userAccount,
    process: finding.process,
    command: finding.command,
    evidenceText: finding.evidenceText,
    mitreTechniqueId: finding.mitreTechniqueId,
    mitreTechniqueName: finding.mitreTechniqueName,
    mitreTactic: finding.mitreTactic,
    confidence: finding.confidence,
    risk: fromBackendSeverity(finding.risk),
    createdAt: finding.createdAt,
  };
}

function adaptAgentDecision(decision: BackendAiAgentDecision): AiAgentDecision {
  return {
    id: decision.id,
    agent: fromBackendAiAgentName(decision.agent),
    action: decision.action,
    generatedBy: decision.generatedBy,
    confidence: decision.confidence,
    evidenceRefs: decision.evidenceRefs,
    summary: decision.summary,
    createdAt: decision.createdAt,
  };
}

export const incidentsService = {
  async list(): Promise<AlertRecord[]> {
    const { data } = await apiClient.get<BackendIncident[]>('/ai/incidents');
    return data.map(adapt);
  },

  async get(id: string): Promise<AlertRecord> {
    const { data } = await apiClient.get<BackendIncident>(`/ai/incidents/${id}`);
    return adapt(data);
  },

  async updateStatus(id: string, status: IncidentStatus): Promise<AlertRecord> {
    const { data } = await apiClient.patch<BackendIncident>(`/ai/incidents/${id}/status`, {
      status: toBackendIncidentStatus(status),
    });
    return adapt(data);
  },

  /** "Acknowledge & Investigate" — the explicit response that stops the
   * backend's 5-minute automated containment. Idempotent server-side. */
  async acknowledge(id: string): Promise<{ alreadyAcknowledged: boolean; response: ResponseWindow }> {
    const { data } = await apiClient.post<BackendAcknowledgeResult>(`/ai/incidents/${id}/acknowledge`);
    return { alreadyAcknowledged: data.alreadyAcknowledged, response: fromBackendResponseWindow(data.response) };
  },

  async findSimilar(id: string): Promise<Array<{ incident: AlertRecord; score: number }>> {
    const { data } = await apiClient.get<BackendSimilarIncident[]>(`/ai/incidents/${id}/similar`);
    return data.map((entry) => ({ incident: adapt(entry.incident), score: entry.score }));
  },

  /** Drives Simulation Mode: posts a synthetic log excerpt through the real AI triage pipeline. */
  async analyze(input: {
    sourceExcerpt: string;
    deviceId?: string;
    /** Tags Simulation Mode's synthetic traffic so it's never stored
     * identically to real open-source-dataset-derived evidence — see
     * AnalyzeLogDto on the backend. Omit for any other caller. */
    source?: 'SIMULATION';
  }): Promise<{
    incident: AlertRecord;
    ticketCreated: boolean;
    recommendedFixes: string[];
  }> {
    const { data } = await apiClient.post<BackendAnalyzeResult>('/ai/analyze', input);
    return {
      incident: adapt(data.incident),
      ticketCreated: data.ticket !== null,
      recommendedFixes: data.recommendedFixes,
    };
  },

  async generateAnalystReport(
    id: string,
  ): Promise<{ report: string; generatedBy: 'claude' | 'rule-based-fallback' }> {
    const { data } = await apiClient.post<{
      report: string;
      generatedBy: 'claude' | 'rule-based-fallback';
    }>(`/ai/incidents/${id}/analyst-report`);
    return data;
  },

  /** Requirement #39 — triggers a browser download of the full Case-Based Digital Forensics Report PDF. */
  async downloadCaseReport(id: string, caseId: string): Promise<void> {
    const { data } = await apiClient.get<Blob>(`/reports/case/${id}`, { responseType: 'blob' });
    downloadBlob(`MIRQAB_Case_Report_${caseId}.pdf`, data);
  },

  /** The Similar Attack Analysis investigation bundle — see backend AiService.getInvestigation. */
  async getInvestigation(id: string): Promise<IncidentInvestigation> {
    const { data } = await apiClient.get<BackendIncidentInvestigation>(
      `/ai/incidents/${id}/investigation`,
    );
    return adaptInvestigation(data);
  },

  async listActions(id: string): Promise<IncidentAction[]> {
    const { data } = await apiClient.get<BackendIncidentAction[]>(`/ai/incidents/${id}/actions`);
    return data.map(adaptAction);
  },

  async logAction(
    id: string,
    input: { type: IncidentAction['type']; outcome?: IncidentAction['outcome']; notes?: string },
  ): Promise<IncidentAction> {
    const { data } = await apiClient.post<BackendIncidentAction>(`/ai/incidents/${id}/actions`, {
      type: toBackendActionType(input.type),
      outcome: input.outcome ? toBackendActionOutcome(input.outcome) : undefined,
      notes: input.notes,
    });
    return adaptAction(data);
  },

  async updateActionOutcome(
    id: string,
    actionId: string,
    outcome: IncidentAction['outcome'],
  ): Promise<IncidentAction> {
    const { data } = await apiClient.patch<BackendIncidentAction>(
      `/ai/incidents/${id}/actions/${actionId}`,
      {
        outcome: toBackendActionOutcome(outcome),
      },
    );
    return adaptAction(data);
  },

  async applyRecommended(id: string, types: IncidentAction['type'][]): Promise<IncidentAction[]> {
    const { data } = await apiClient.post<BackendIncidentAction[]>(
      `/ai/incidents/${id}/apply-recommended`,
      {
        types: types.map(toBackendActionType),
      },
    );
    return data.map(adaptAction);
  },

  /** Requirement #6: explicit human sign-off before a high-impact AI-recommended action can execute. */
  async approveAction(id: string, actionId: string): Promise<IncidentAction> {
    const { data } = await apiClient.post<BackendIncidentAction>(
      `/ai/incidents/${id}/actions/${actionId}/approve`,
    );
    return adaptAction(data);
  },

  async rejectAction(id: string, actionId: string, reason?: string): Promise<IncidentAction> {
    const { data } = await apiClient.post<BackendIncidentAction>(
      `/ai/incidents/${id}/actions/${actionId}/reject`,
      { reason },
    );
    return adaptAction(data);
  },

  /** The composed history record — see backend AiService.getIncidentHistory. */
  async getHistory(id: string): Promise<IncidentHistoryRecord> {
    const { data } = await apiClient.get<BackendIncidentHistory>(`/ai/incidents/${id}/history`);
    return adaptHistory(data);
  },

  async updateResolution(
    id: string,
    input: { rootCause?: string; finalResolution?: string; lessonsLearned?: string },
  ): Promise<AlertRecord> {
    const { data } = await apiClient.patch<BackendIncident>(
      `/ai/incidents/${id}/resolution`,
      input,
    );
    return adapt(data);
  },

  /** Real IOC/IOA findings extracted from this incident's evidence — see backend detection/indicator.util.ts. */
  async listIndicators(id: string): Promise<Indicator[]> {
    const { data } = await apiClient.get<BackendIndicator[]>(`/ai/incidents/${id}/indicators`);
    return data.map(adaptIndicator);
  },

  /** Persistence-mechanism findings (scheduled tasks, run keys, etc.) — see backend detection/persistence.util.ts. */
  async listPersistenceFindings(id: string): Promise<PersistenceFinding[]> {
    const { data } = await apiClient.get<BackendPersistenceFinding[]>(
      `/ai/incidents/${id}/persistence-findings`,
    );
    return data.map(adaptPersistenceFinding);
  },

  /** Audit trail of what each named AI agent was permitted to do and did — Requirement #29 multi-agent model. */
  async listAgentDecisions(id: string): Promise<AiAgentDecision[]> {
    const { data } = await apiClient.get<BackendAiAgentDecision[]>(
      `/ai/incidents/${id}/agent-decisions`,
    );
    return data.map(adaptAgentDecision);
  },
};

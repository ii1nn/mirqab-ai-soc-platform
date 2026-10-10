import { Device, EventSource, Incident, IncidentStatus, Severity } from '@prisma/client';
import { ComparableIncident, compareIncidents } from '../comparison/incident-comparison.util';
import { IncidentEnrichment } from '../enrichment/incident-enrichment.util';
import { TriageResult } from '../interfaces/triage-result.interface';

/** Cases stay eligible to absorb new evidence while in any of these statuses.
 * RESOLVED/CLOSED cases never receive new evidence — a device that gets
 * re-compromised after remediation starts a fresh case instead. */
export const CORRELATABLE_STATUSES: IncidentStatus[] = [
  IncidentStatus.OPEN,
  IncidentStatus.INVESTIGATING,
  IncidentStatus.CONTAINED,
];

/** Sliding window anchored on `lastEvidenceAt`, not `createdAt` — a case that
 * keeps producing evidence every day or two stays open indefinitely; 72h of
 * silence closes the window and the next event starts a new case. Matches
 * the 72h "lateral movement" window RiskPredictionService already uses. */
export const CORRELATION_WINDOW_MS = 72 * 60 * 60 * 1000;

/** Score (out of the same 0-100 scale compareIncidents produces) an incoming
 * event must reach against an existing open case before it's treated as
 * more evidence for that case rather than a new one. Deliberately well above
 * the ~26pt floor a same-device, same-department, recent-timestamp event
 * already gets "for free" from compareIncidents' device/department/timeline
 * dimensions — 65 in practice requires real thematic overlap (matching
 * MITRE technique+tactic, or technique plus IOC/malware overlap), not just
 * proximity in time and location. */
export const CORRELATION_THRESHOLD = 65;

/**
 * Builds a not-yet-persisted, `compareIncidents()`-shaped snapshot of an
 * incoming event from its classification + enrichment — everything
 * `AiService.analyzeLog()` already computes before creating the `Incident`
 * row. Reusing the real comparison engine (rather than inventing separate
 * correlation-matching logic) means this stays consistent with the Similar
 * Attack Analysis engine and gets its explainable per-dimension breakdown
 * for free (useful for showing an analyst *why* two events were merged).
 */
export function buildCandidateSnapshot(params: {
  classification: TriageResult;
  enrichment: IncidentEnrichment;
  deviceId?: string;
  departmentId?: string;
  organizationId?: string;
  device: Device | null;
}): ComparableIncident {
  const now = new Date();
  return {
    id: '',
    caseId: '',
    title: params.classification.title,
    description: params.classification.description,
    severity: params.classification.severity as Severity,
    mitreTechniqueId: params.classification.technique.id,
    mitreTechniqueName: params.classification.technique.name,
    mitreTactic: params.classification.technique.tactic,
    departmentId: params.departmentId ?? null,
    // Phase 2.6B: not part of compareIncidents()'s scoring dimensions
    // (correlation matching is about attack-pattern similarity, not tenant
    // ownership — a candidate's organization was already fixed before it
    // ever reached this ranking step, via the department-scoped candidate
    // query in AiService.analyzeLog). Included only so this object
    // structurally satisfies ComparableIncident.
    organizationId: params.organizationId ?? null,
    deviceId: params.deviceId ?? null,
    sourceExcerpt: '',
    status: IncidentStatus.OPEN,
    generatedBy: params.classification.generatedBy,
    createdAt: now,
    updatedAt: now,
    lastEvidenceAt: now,
    acknowledgedAt: null,
    resolvedAt: null,
    rootCause: null,
    finalResolution: null,
    lessonsLearned: null,
    malwareFamily: params.enrichment.malwareFamily,
    sourceIp: params.enrichment.sourceIp,
    sourceCountry: params.enrichment.sourceCountry,
    destinationAsset: params.enrichment.destinationAsset,
    iocs: params.enrichment.iocs,
    detectionRule: params.enrichment.detectionRule,
    userAccount: params.enrichment.userAccount,
    // Not-yet-persisted scoring snapshot only — real provenance is attached
    // separately when the event is actually written (see AiService.analyzeLog).
    // Not part of compareIncidents()'s scoring dimensions.
    ingestSource: EventSource.MANUAL_TEST,
    datasetOrigin: null,
    rawEvent: null,
    device: params.device,
  };
}

export interface CorrelationMatch {
  incident: Incident;
  score: number;
}

/**
 * Scores an incoming event against every open candidate on the same device
 * and returns the best match, if any clears CORRELATION_THRESHOLD. Callers
 * are expected to have already filtered `candidates` to the same device and
 * the CORRELATABLE_STATUSES/CORRELATION_WINDOW_MS constraints — this
 * function only ranks what it's given.
 */
export function findCorrelatedCase(
  snapshot: ComparableIncident,
  candidates: (Incident & { device: Device | null })[],
): CorrelationMatch | null {
  let best: CorrelationMatch | null = null;

  for (const candidate of candidates) {
    const { score } = compareIncidents(snapshot, candidate);
    if (score >= CORRELATION_THRESHOLD && (!best || score > best.score)) {
      best = { incident: candidate, score };
    }
  }

  return best;
}

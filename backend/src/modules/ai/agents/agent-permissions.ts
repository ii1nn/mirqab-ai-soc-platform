/**
 * Least-privilege declaration for each named AI agent (requirement #29).
 * This is documentation enforced by code shape, not a runtime sandbox: each
 * agent is a thin, named wrapper around exactly the existing service call(s)
 * listed below, and never receives anything beyond what's declared here.
 * The actual boundary is structural — e.g. MITRE_RISK_AGENT's only route
 * into the database is RiskPredictionService.predict(), which itself only
 * ever runs SELECT queries — not a permission check that could be bypassed.
 *
 * None of these agents can create/update an IncidentAction, call a Wazuh
 * active-response endpoint, or otherwise reach an endpoint/network control.
 * That capability is deliberately not wired to any agent — see AiService
 * .createIncidentAction/.applyRecommended, both of which require a real
 * `actorEmail` from an authenticated HTTP request, never an internal
 * agent-originated call. This is what requirement #6 ("AI must not control
 * the environment by itself") actually means in this codebase: it isn't a
 * permission the agents are denied, it's a capability they were never given.
 */

export type AgentName =
  'INCIDENT_AGENT' | 'IOC_IOA_AGENT' | 'MITRE_RISK_AGENT' | 'RECOMMENDATION_AGENT';

export interface AgentPermission {
  name: AgentName;
  /** What this agent is allowed to read. */
  reads: string[];
  /** What this agent is allowed to write — deliberately narrow. */
  writes: string[];
  /** Capabilities explicitly withheld, stated for clarity even though the
   * agent's code has no path to them regardless. */
  neverAllowed: string[];
  /** The concrete service call(s) this agent wraps — the actual enforcement
   * mechanism (see the module comment above). */
  implementedBy: string;
}

export const AGENT_PERMISSIONS: Record<AgentName, AgentPermission> = {
  INCIDENT_AGENT: {
    name: 'INCIDENT_AGENT',
    reads: ['the single raw sourceExcerpt being classified'],
    writes: ['Incident.title/description/severity/mitreTechniqueId (via AiService.createNewCase)'],
    neverAllowed: ['other incidents’ data', 'IncidentAction creation', 'endpoint/network control'],
    implementedBy:
      'AiService.classify() -> ClaudeService.generateStructured / MitreMappingService.match()',
  },
  IOC_IOA_AGENT: {
    name: 'IOC_IOA_AGENT',
    reads: ['the single raw sourceExcerpt being scanned', 'its already-derived IncidentEnrichment'],
    writes: [
      'Indicator rows',
      'PersistenceFinding rows (scoped to the one incidentId it was called for)',
    ],
    neverAllowed: ['other incidents’ data', 'IncidentAction creation', 'endpoint/network control'],
    implementedBy:
      'AiService.runDetection() -> detection/indicator.util.ts, detection/persistence.util.ts, detection/c2.util.ts',
  },
  MITRE_RISK_AGENT: {
    name: 'MITRE_RISK_AGENT',
    reads: [
      'the target incident',
      'past incidents in the same department only (never cross-department)',
    ],
    writes: ['nothing persisted — RiskPrediction is computed and returned, not stored'],
    neverAllowed: [
      'other departments’ incident data',
      'IncidentAction creation',
      'endpoint/network control',
    ],
    implementedBy:
      'AiService.getInvestigation() -> RiskPredictionService.predict() / MitreMappingService',
  },
  RECOMMENDATION_AGENT: {
    name: 'RECOMMENDATION_AGENT',
    reads: [
      'IncidentAction outcome history of similar past incidents only (type + outcome, no free text)',
    ],
    writes: [
      'nothing persisted — recommendations are computed and returned, not stored or auto-applied',
    ],
    neverAllowed: [
      'creating or updating any IncidentAction itself',
      'marking any action SUCCESS/FAILED',
      'endpoint/network control',
    ],
    implementedBy:
      'AiService.buildRecommendations() — pure aggregation over already-fetched IncidentAction rows',
  },
};

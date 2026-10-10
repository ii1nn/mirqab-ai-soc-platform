import { EventSource, Severity } from '@prisma/client';

export interface TriageResult {
  title: string;
  description: string;
  severity: Severity;
  technique: {
    id: string;
    name: string;
    tactic: string;
  };
  recommendedFixes: string[];
  /** The AiProvider.providerId that produced this result (e.g.
   * 'self-hosted', 'claude-dev-only'), or 'rule-based-fallback' when no AI
   * provider was active/available. Phase 8: no longer a fixed
   * 'claude'-vs-fallback union — see AiProviderRegistry.providerId. */
  generatedBy: string;
}

export interface AnalyzeLogInput {
  sourceExcerpt: string;
  /** Department is derived server-side from this device — see AiService.analyzeLog. */
  deviceId?: string;
  /** The untouched original event text/JSON this sourceExcerpt was normalized
   * from — preserved separately so evidence always traces back to its real
   * source. Never fabricated: null when the caller has no raw form to give. */
  rawEvent?: string;
  /** Where this event actually came from — see EventSource. Defaults to
   * MANUAL_TEST when omitted; only server-side ingestion code (never a raw
   * client payload) may set OPEN_SOURCE_DATASET/LIVE_AGENT. */
  ingestSource?: EventSource;
  /** Which datasets/* folder this came from, when ingestSource is OPEN_SOURCE_DATASET. */
  datasetOrigin?: string;
}

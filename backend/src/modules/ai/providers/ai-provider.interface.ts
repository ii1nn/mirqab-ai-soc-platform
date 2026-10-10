/**
 * Phase 8: the common shape every AI inference backend (self-hosted or
 * external/dev-only) must implement, so `AiService` never depends on a
 * specific provider's SDK/wire format directly. `AiService` resolves exactly
 * ONE active provider at startup (see AiProviderRegistry) — providers are
 * never chained at request time (no "self-hosted failed, try the other one"
 * behavior), matching the requirement that a local-AI failure must fall back
 * to the deterministic engine, never silently escalate to a different AI
 * backend.
 */

export type AiEffort = 'low' | 'medium' | 'high';

export interface AiStructuredCallOptions {
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  effort?: AiEffort;
  maxTokens?: number;
}

export interface AiTextCallOptions {
  systemPrompt: string;
  userPrompt: string;
  effort?: AiEffort;
  maxTokens?: number;
}

export interface AiProvider {
  /** A short, stable identifier persisted alongside AI-generated content
   * (Incident.generatedBy, AiAgentDecision.generatedBy) so an analyst can
   * always tell which engine produced a given result — see Section 12
   * (model/prompt versioning) of the Phase 8 report. Never 'claude' for a
   * self-hosted provider and vice versa. */
  readonly providerId: string;

  isAvailable(): boolean;
  generateStructured<T>(options: AiStructuredCallOptions): Promise<T>;
  generateText(options: AiTextCallOptions): Promise<string>;
}

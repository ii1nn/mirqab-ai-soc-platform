import { Injectable, Logger } from '@nestjs/common';
import { ClaudeService } from '../claude/claude.service';
import { AiProvider, AiStructuredCallOptions, AiTextCallOptions } from './ai-provider.interface';
import { SelfHostedAiProvider } from './self-hosted-ai.provider';

/** Phase 9: consecutive-failure threshold before the circuit opens. Small on
 * purpose — a single flaky response shouldn't disable AI for a minute, but a
 * genuinely down/unreachable provider should stop being retried quickly. */
const FAILURE_THRESHOLD = 3;
/** How long the circuit stays open (calls fail fast, no network attempt)
 * before a single trial request is allowed through again. */
const COOLDOWN_MS = 60_000;
/** Phase 9: hard cap on simultaneous in-flight AI calls — protects against
 * the "N incidents arrive at once, N expensive connection attempts pile up"
 * resource-exhaustion scenario, independent of whether the provider is up,
 * down, or merely slow. Requests beyond this cap fail fast (→ deterministic
 * fallback) rather than queuing indefinitely. */
const MAX_CONCURRENT_REQUESTS = 10;

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface AiProviderStatus {
  providerId: string | null;
  available: boolean;
  circuitState: CircuitState;
  consecutiveFailures: number;
  inFlightRequests: number;
  circuitOpenUntil: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
}

/**
 * Phase 8: resolves exactly ONE active AI provider, once, at construction —
 * self-hosted takes priority whenever configured; the external Claude
 * provider is only ever considered when self-hosted is unavailable AND it
 * has separately been explicitly enabled for local dev (see
 * ClaudeService's own ALLOW_EXTERNAL_AI_DEV_ONLY gate). Providers are never
 * chained at request time — if the active provider's call fails, AiService
 * catches that and falls back to deterministic rule-based analysis; it does
 * NOT try a second AI provider. This is what makes "local AI failed →
 * silently call Claude" structurally impossible rather than just avoided by
 * convention.
 *
 * Phase 9: adds failure containment around whichever provider is active —
 * a simple in-memory circuit breaker (opens after FAILURE_THRESHOLD
 * consecutive failures, fails fast for COOLDOWN_MS, then allows one trial
 * request) plus a bounded-concurrency cap. Both apply uniformly regardless
 * of which provider is active, and both fail CLOSED toward the deterministic
 * engine, never toward inventing a result or trying a second AI provider.
 */
@Injectable()
export class AiProviderRegistry {
  private readonly logger = new Logger(AiProviderRegistry.name);
  private readonly active: AiProvider | null;

  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private halfOpenTrialInFlight = false;
  private inFlightRequests = 0;
  private lastFailureAt: number | null = null;
  private lastFailureReason: string | null = null;

  constructor(selfHosted: SelfHostedAiProvider, claude: ClaudeService) {
    const providers: AiProvider[] = [selfHosted, claude];
    this.active = providers.find((provider) => provider.isAvailable()) ?? null;

    if (this.active === selfHosted) {
      this.logger.log('Active AI provider: self-hosted (private/internal inference).');
    } else if (this.active === claude) {
      this.logger.warn(
        'Active AI provider: claude-dev-only (EXTERNAL). This must never be true in a production deployment.',
      );
    } else {
      this.logger.log(
        'No AI provider active — every AI-eligible task will use its deterministic rule-based fallback.',
      );
    }
  }

  /** Section 12/14: lets callers stamp AI-generated content with exactly
   * which engine produced it, and lets operators inspect provider health. */
  get providerId(): string | null {
    return this.active?.providerId ?? null;
  }

  /** False whenever no provider is configured, OR the circuit is currently
   * open — either way, AiService's callers should go straight to the
   * deterministic fallback without attempting a network call at all. */
  isAvailable(): boolean {
    return this.active !== null && !this.isCircuitOpen();
  }

  /** Phase 9 observability (Section 14) — no prompts, no incident content,
   * only provider health metrics, safe to expose to an authenticated
   * analyst/admin endpoint. */
  getStatus(): AiProviderStatus {
    return {
      providerId: this.active?.providerId ?? null,
      available: this.isAvailable(),
      circuitState: this.circuitState(),
      consecutiveFailures: this.consecutiveFailures,
      inFlightRequests: this.inFlightRequests,
      circuitOpenUntil: this.circuitOpenUntil > 0 ? new Date(this.circuitOpenUntil).toISOString() : null,
      lastFailureAt: this.lastFailureAt ? new Date(this.lastFailureAt).toISOString() : null,
      lastFailureReason: this.lastFailureReason,
    };
  }

  async generateStructured<T>(options: AiStructuredCallOptions): Promise<T> {
    return this.guarded(() => this.requireActive().generateStructured<T>(options));
  }

  async generateText(options: AiTextCallOptions): Promise<string> {
    return this.guarded(() => this.requireActive().generateText(options));
  }

  private requireActive(): AiProvider {
    if (!this.active) {
      throw new Error('No AI provider is active');
    }
    return this.active;
  }

  /** Shared circuit-breaker + concurrency-cap wrapper around both call
   * types. Never retries internally and never tries a second provider —
   * exactly one attempt against the one active provider, its outcome only
   * feeding the failure/success bookkeeping used to decide whether FUTURE
   * calls should even be attempted. */
  private async guarded<T>(call: () => Promise<T>): Promise<T> {
    if (!this.active) {
      throw new Error('No AI provider is active');
    }
    if (this.isCircuitOpen()) {
      throw new Error(
        `AI provider circuit breaker is open (${this.consecutiveFailures} consecutive failures) — failing fast until ${new Date(this.circuitOpenUntil).toISOString()}`,
      );
    }
    if (this.inFlightRequests >= MAX_CONCURRENT_REQUESTS) {
      throw new Error(
        `AI provider concurrency limit reached (${MAX_CONCURRENT_REQUESTS} in-flight requests) — failing fast rather than queuing`,
      );
    }

    const isHalfOpenTrial = this.circuitState() === 'half-open';
    if (isHalfOpenTrial) {
      this.halfOpenTrialInFlight = true;
    }
    this.inFlightRequests += 1;

    try {
      const result = await call();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    } finally {
      this.inFlightRequests -= 1;
      if (isHalfOpenTrial) {
        this.halfOpenTrialInFlight = false;
      }
    }
  }

  /** 'closed': normal operation (never tripped, or a trial call already
   * succeeded and reset the counters). 'open': cooldown window still
   * active — every call fails fast, no network attempt at all. 'half-open':
   * cooldown has elapsed but the trip hasn't been confirmed-recovered yet —
   * exactly one trial call is allowed through (see isCircuitOpen). */
  private circuitState(): CircuitState {
    const cooldownActive = Date.now() < this.circuitOpenUntil;
    if (cooldownActive) return 'open';
    if (this.consecutiveFailures >= FAILURE_THRESHOLD) return 'half-open';
    return 'closed';
  }

  private isCircuitOpen(): boolean {
    switch (this.circuitState()) {
      case 'closed':
        return false;
      case 'open':
        return true;
      case 'half-open':
        // Allow exactly one trial through; any other concurrent caller
        // still fails fast while that trial is in flight.
        return this.halfOpenTrialInFlight;
    }
  }

  private onSuccess(): void {
    if (this.consecutiveFailures > 0) {
      this.logger.log(
        `AI provider recovered after ${this.consecutiveFailures} consecutive failure(s) — circuit closed.`,
      );
    }
    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;
  }

  private onFailure(error: unknown): void {
    this.consecutiveFailures += 1;
    this.lastFailureAt = Date.now();
    this.lastFailureReason = error instanceof Error ? error.message : String(error);

    if (this.consecutiveFailures >= FAILURE_THRESHOLD) {
      this.circuitOpenUntil = Date.now() + COOLDOWN_MS;
      this.logger.warn(
        `AI provider circuit breaker OPEN for ${COOLDOWN_MS}ms after ${this.consecutiveFailures} consecutive failures. Last error: ${this.lastFailureReason}`,
      );
    }
  }
}

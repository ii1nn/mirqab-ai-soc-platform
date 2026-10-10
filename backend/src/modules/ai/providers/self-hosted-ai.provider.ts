import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiProvider,
  AiStructuredCallOptions,
  AiTextCallOptions,
} from './ai-provider.interface';

/** Hard caps independent of anything a caller passes in — defense in depth
 * alongside the DTO-level MaxLength validation (Phase 5) that already bounds
 * sourceExcerpt/etc. before it ever reaches AiService. Protects the self-
 * hosted runtime (which may have far less request-handling hardening than a
 * managed cloud API) from an oversized or slow-loris-style request. */
const MAX_PROMPT_CHARS = 60_000;
const MAX_RESPONSE_BYTES = 1_000_000;

/**
 * Speaks the OpenAI-compatible `/v1/chat/completions` wire format — the
 * common denominator supported by every realistic self-hosted runtime
 * (llama.cpp's `server`, Ollama's OpenAI-compat endpoint, vLLM, LocalAI),
 * so swapping the actual runtime later never requires touching AiService.
 *
 * `baseUrl`/`model` come exclusively from server-side config
 * (SELF_HOSTED_AI_URL/SELF_HOSTED_AI_MODEL) — never from a request body or
 * any client-controllable input (Phase 8 requirement: "no arbitrary
 * URL/model endpoint supplied by clients").
 *
 * Self-hosted/local models are far less reliable than Claude's schema-
 * constrained structured output at strictly following a JSON schema — so
 * unlike ClaudeService (which trusts `output_config.format` to guarantee
 * shape), this provider treats every response as untrusted text and
 * strictly re-validates it against the requested schema before returning,
 * never assuming well-formed JSON came back.
 */
@Injectable()
export class SelfHostedAiProvider implements AiProvider {
  readonly providerId = 'self-hosted';
  private readonly logger = new Logger(SelfHostedAiProvider.name);
  private readonly baseUrl: string | undefined;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    const rawBaseUrl = this.configService.get<string>('selfHostedAi.baseUrl');
    // Trim a trailing slash so `${baseUrl}/v1/chat/completions` never double-slashes.
    this.baseUrl = rawBaseUrl ? rawBaseUrl.replace(/\/+$/, '') : undefined;
    this.model = this.configService.get<string>('selfHostedAi.model') ?? 'local-model';
    this.timeoutMs = this.configService.get<number>('selfHostedAi.timeoutMs') ?? 30_000;

    if (!this.baseUrl) {
      this.logger.warn(
        'SELF_HOSTED_AI_URL is not set — AI features will use deterministic rule-based analysis. ' +
          'See MIRQAB-PHASE-8-SELF-HOSTED-AI-REPORT.md for the hardware assessment behind this default.',
      );
    }
  }

  isAvailable(): boolean {
    return this.baseUrl !== undefined;
  }

  async generateStructured<T>(options: AiStructuredCallOptions): Promise<T> {
    const instructedSystemPrompt = `${options.systemPrompt}\n\nRespond with ONLY a single JSON object matching this shape (no markdown fences, no commentary): ${JSON.stringify(options.schema)}`;
    const raw = await this.complete({
      systemPrompt: instructedSystemPrompt,
      userPrompt: options.userPrompt,
      maxTokens: options.maxTokens,
    });

    const parsed = extractJson(raw);
    if (parsed === null) {
      throw new Error('Self-hosted model response did not contain valid JSON');
    }
    validateAgainstSchema(parsed, options.schema);
    return parsed as T;
  }

  async generateText(options: AiTextCallOptions): Promise<string> {
    return this.complete({
      systemPrompt: options.systemPrompt,
      userPrompt: options.userPrompt,
      maxTokens: options.maxTokens,
    });
  }

  private async complete(args: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
  }): Promise<string> {
    if (!this.baseUrl) {
      throw new Error('Self-hosted AI provider is not configured (SELF_HOSTED_AI_URL unset)');
    }

    const userPrompt = args.userPrompt.slice(0, MAX_PROMPT_CHARS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          max_tokens: args.maxTokens ?? 1024,
          temperature: 0.1,
          messages: [
            { role: 'system', content: args.systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Self-hosted AI runtime returned HTTP ${response.status}`);
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
        throw new Error('Self-hosted AI runtime response exceeded the allowed size');
      }

      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = body.choices?.[0]?.message?.content;
      if (typeof text !== 'string') {
        throw new Error('Self-hosted AI runtime response had no message content');
      }
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Local models frequently wrap JSON in ```json fences or add leading/trailing
 * prose despite instructions — extract the first balanced-looking JSON object
 * rather than assuming `JSON.parse(raw)` works directly. */
function extractJson(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  try {
    const value = JSON.parse(candidate.slice(start, end + 1));
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Minimal, dependency-free structural validation: every field in
 * `schema.required` must be present and of the declared `type`, and any
 * `enum` constraint must be satisfied. Deliberately narrow (this project's
 * schemas are flat, {title,description,severity,mitreTechniqueId}-shaped) —
 * not a general-purpose JSON Schema validator. Throws on any violation so
 * callers never receive a partially-valid object. */
function validateAgainstSchema(value: Record<string, unknown>, schema: Record<string, unknown>): void {
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const properties = (schema.properties ?? {}) as Record<string, { type?: string; enum?: unknown[] }>;

  for (const key of required) {
    if (!(key in value)) {
      throw new Error(`Self-hosted model response is missing required field "${key}"`);
    }
    const propSchema = properties[key];
    const fieldValue = value[key];
    if (propSchema?.type === 'string' && typeof fieldValue !== 'string') {
      throw new Error(`Self-hosted model response field "${key}" must be a string`);
    }
    if (propSchema?.enum && !propSchema.enum.includes(fieldValue)) {
      throw new Error(
        `Self-hosted model response field "${key}" has an invalid value outside its allowed enum`,
      );
    }
  }
}

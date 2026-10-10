import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { AiProvider } from '../providers/ai-provider.interface';
import { ClaudeRefusalError, ClaudeUnavailableError } from './claude.errors';

export type ClaudeEffort = 'low' | 'medium' | 'high';

interface StructuredCallOptions {
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  effort?: ClaudeEffort;
  maxTokens?: number;
}

interface TextCallOptions {
  systemPrompt: string;
  userPrompt: string;
  effort?: ClaudeEffort;
  maxTokens?: number;
}

/**
 * `output_config` (structured JSON outputs / effort) is newer than some
 * installed SDK type definitions — extend the base params locally rather
 * than casting to `any` at every call site.
 */
interface OutputConfig {
  effort?: ClaudeEffort;
  format?: {
    type: 'json_schema';
    schema: Record<string, unknown>;
  };
}

type CreateParams = Anthropic.MessageCreateParams & { output_config?: OutputConfig };

/**
 * Thin wrapper over the Anthropic Messages API.
 *
 * Phase 8: this is an EXTERNAL, CLOUD AI provider — Mirqab is a SOC product
 * that must never send an organization's incident/log data outside its own
 * environment in production. `ANTHROPIC_API_KEY` alone is deliberately no
 * longer sufficient to activate this service: `ALLOW_EXTERNAL_AI_DEV_ONLY`
 * must ALSO be explicitly set, so an operator can never enable an external
 * AI call by accident (e.g. a stray API key surviving into a production
 * `.env`). Intended strictly for local development / model-quality
 * comparison — see MIRQAB-PHASE-8-SELF-HOSTED-AI-REPORT.md. `AiService`
 * never chains from a failed self-hosted call into this provider — the two
 * are mutually exclusive, resolved once at startup by AiProviderRegistry.
 */
@Injectable()
export class ClaudeService implements AiProvider {
  readonly providerId = 'claude-dev-only';
  private readonly logger = new Logger(ClaudeService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('claude.apiKey');
    const allowExternalDevOnly = this.configService.get<boolean>('claude.allowExternalDevOnly');
    this.model = this.configService.get<string>('claude.model') ?? 'claude-opus-5';
    // Phase 9: the SDK's own defaults (historically a very long request
    // timeout, plus automatic internal retries on transient errors) mean an
    // unbounded/degraded Claude call could hang far longer than any caller
    // expects — unlike SelfHostedAiProvider, which has always had an
    // explicit AbortController timeout. Bounding both here closes that gap
    // for the dev-only path too, so a hung dev Claude call can never block
    // an incident-analysis request indefinitely. `maxRetries: 1` (not the
    // SDK's default of 2) keeps worst-case latency close to `timeout` itself
    // rather than a multiple of it.
    const timeoutMs = this.configService.get<number>('claude.timeoutMs') ?? 30_000;
    this.client =
      apiKey && allowExternalDevOnly ? new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 }) : null;

    if (apiKey && !allowExternalDevOnly) {
      this.logger.warn(
        'ANTHROPIC_API_KEY is set but ALLOW_EXTERNAL_AI_DEV_ONLY is not "true" — ' +
          'the external Claude provider stays DISABLED (Phase 8 fail-closed default). ' +
          'This is expected in production.',
      );
    } else if (!this.client) {
      this.logger.warn('External Claude provider is disabled — AI features use rule-based fallbacks unless a self-hosted provider is configured.');
    } else {
      this.logger.warn(
        'External Claude provider is ACTIVE (ALLOW_EXTERNAL_AI_DEV_ONLY=true) — incident data will be sent to Anthropic. Never enable this in production.',
      );
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  /** Structured JSON output constrained to `schema` via `output_config.format` — no tool-use round trip needed. */
  async generateStructured<T>(options: StructuredCallOptions): Promise<T> {
    const response = await this.createMessage({
      systemPrompt: options.systemPrompt,
      userPrompt: options.userPrompt,
      maxTokens: options.maxTokens ?? 1024,
      outputConfig: {
        effort: options.effort ?? 'medium',
        format: { type: 'json_schema', schema: options.schema },
      },
    });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    if (!textBlock) {
      throw new Error('Claude response contained no text content to parse');
    }

    return JSON.parse(textBlock.text) as T;
  }

  async generateText(options: TextCallOptions): Promise<string> {
    const response = await this.createMessage({
      systemPrompt: options.systemPrompt,
      userPrompt: options.userPrompt,
      maxTokens: options.maxTokens ?? 1024,
      outputConfig: { effort: options.effort ?? 'medium' },
    });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    return textBlock?.text ?? '';
  }

  private async createMessage(args: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens: number;
    outputConfig: OutputConfig;
  }): Promise<Anthropic.Message> {
    if (!this.client) {
      throw new ClaudeUnavailableError();
    }

    const params: CreateParams = {
      model: this.model,
      max_tokens: args.maxTokens,
      system: [
        {
          type: 'text',
          text: args.systemPrompt,
          // Every call of a given task type reuses the same system prompt —
          // caching this cuts repeat-call cost by ~90% (see shared/prompt-caching.md).
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: args.userPrompt }],
      output_config: args.outputConfig,
    };

    const response = await this.client.messages.create(params);

    if (response.stop_reason === 'refusal') {
      throw new ClaudeRefusalError();
    }

    return response;
  }
}

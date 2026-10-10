import { ConfigService } from '@nestjs/config';
import { ClaudeService } from './claude.service';

const anthropicConstructorSpy = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: class MockAnthropic {
    constructor(options: unknown) {
      anthropicConstructorSpy(options);
    }
  },
}));

/**
 * Phase 8: proves the dual-gate fail-closed default — an API key alone must
 * never be sufficient to activate this external, cloud AI provider.
 */
describe('ClaudeService (Phase 8 external-provider gating)', () => {
  function build(config: Record<string, unknown>): ClaudeService {
    const configService = { get: (key: string) => config[key] } as unknown as ConfigService;
    return new ClaudeService(configService);
  }

  it('stays disabled when ANTHROPIC_API_KEY is set but ALLOW_EXTERNAL_AI_DEV_ONLY is not true', () => {
    const service = build({ 'claude.apiKey': 'sk-real-key', 'claude.allowExternalDevOnly': false });
    expect(service.isAvailable()).toBe(false);
  });

  it('stays disabled when ALLOW_EXTERNAL_AI_DEV_ONLY is true but no API key is set', () => {
    const service = build({ 'claude.apiKey': undefined, 'claude.allowExternalDevOnly': true });
    expect(service.isAvailable()).toBe(false);
  });

  it('stays disabled with neither set (the production default in this environment)', () => {
    const service = build({ 'claude.apiKey': undefined, 'claude.allowExternalDevOnly': false });
    expect(service.isAvailable()).toBe(false);
  });

  it('activates only when BOTH the API key and the explicit dev-only opt-in are set', () => {
    const service = build({ 'claude.apiKey': 'sk-real-key', 'claude.allowExternalDevOnly': true });
    expect(service.isAvailable()).toBe(true);
  });

  it('reports a distinct, never-confusable providerId', () => {
    const service = build({ 'claude.apiKey': undefined, 'claude.allowExternalDevOnly': false });
    expect(service.providerId).toBe('claude-dev-only');
  });

  describe('Phase 9: bounded request timeout', () => {
    beforeEach(() => {
      anthropicConstructorSpy.mockClear();
    });

    it('constructs the Anthropic client with an explicit timeout and a capped retry count — never the SDK\'s unbounded defaults', () => {
      build({
        'claude.apiKey': 'sk-real-key',
        'claude.allowExternalDevOnly': true,
        'claude.timeoutMs': 45_000,
      });

      expect(anthropicConstructorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 45_000, maxRetries: 1 }),
      );
    });

    it('falls back to a sane default timeout (30s) when none is configured', () => {
      build({ 'claude.apiKey': 'sk-real-key', 'claude.allowExternalDevOnly': true });

      expect(anthropicConstructorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 30_000, maxRetries: 1 }),
      );
    });

    it('never constructs a client at all when the provider stays disabled', () => {
      build({ 'claude.apiKey': 'sk-real-key', 'claude.allowExternalDevOnly': false });

      expect(anthropicConstructorSpy).not.toHaveBeenCalled();
    });
  });
});

import { AiProvider } from './ai-provider.interface';
import { AiProviderRegistry } from './ai-provider.registry';

function fakeProvider(providerId: string, available: boolean): AiProvider {
  return {
    providerId,
    isAvailable: () => available,
    generateStructured: jest.fn(),
    generateText: jest.fn().mockResolvedValue(`response from ${providerId}`),
  };
}

/** A provider whose generateText can be scripted to fail a fixed number of
 * times (simulating a down/unreachable self-hosted runtime) before it
 * starts succeeding again (simulating recovery) — used to drive the
 * circuit-breaker state machine through real transitions without a live
 * network dependency. */
function unreliableProvider(failuresBeforeRecovery: number): {
  provider: AiProvider;
  callCount: () => number;
} {
  let calls = 0;
  const provider: AiProvider = {
    providerId: 'self-hosted',
    isAvailable: () => true,
    generateStructured: jest.fn(),
    generateText: jest.fn().mockImplementation(async () => {
      calls += 1;
      if (calls <= failuresBeforeRecovery) {
        throw new Error(`simulated connection failure #${calls}`);
      }
      return 'recovered response';
    }),
  };
  return { provider, callCount: () => calls };
}

/**
 * Phase 8: proves providers are resolved ONCE, mutually exclusively, with
 * no runtime chaining — the structural guarantee behind "local AI failed
 * must never silently escalate to Claude".
 */
describe('AiProviderRegistry (Phase 8)', () => {
  it('prefers self-hosted when it is available, ignoring Claude entirely', () => {
    const selfHosted = fakeProvider('self-hosted', true);
    const claude = fakeProvider('claude-dev-only', true);
    const registry = new AiProviderRegistry(selfHosted as never, claude as never);

    expect(registry.isAvailable()).toBe(true);
    expect(registry.providerId).toBe('self-hosted');
  });

  it('falls back to claude-dev-only only when self-hosted is unavailable', () => {
    const selfHosted = fakeProvider('self-hosted', false);
    const claude = fakeProvider('claude-dev-only', true);
    const registry = new AiProviderRegistry(selfHosted as never, claude as never);

    expect(registry.isAvailable()).toBe(true);
    expect(registry.providerId).toBe('claude-dev-only');
  });

  it('is unavailable when neither provider is configured — the honest production default here', () => {
    const selfHosted = fakeProvider('self-hosted', false);
    const claude = fakeProvider('claude-dev-only', false);
    const registry = new AiProviderRegistry(selfHosted as never, claude as never);

    expect(registry.isAvailable()).toBe(false);
    expect(registry.providerId).toBeNull();
  });

  it('throws locally rather than silently trying a second provider when no provider is active', async () => {
    const selfHosted = fakeProvider('self-hosted', false);
    const claude = fakeProvider('claude-dev-only', false);
    const registry = new AiProviderRegistry(selfHosted as never, claude as never);

    await expect(registry.generateText({ systemPrompt: 's', userPrompt: 'u' })).rejects.toThrow(
      /No AI provider is active/,
    );
  });

  it('only ever calls the single resolved provider, never both', async () => {
    const selfHosted = fakeProvider('self-hosted', true);
    const claude = fakeProvider('claude-dev-only', true);
    const registry = new AiProviderRegistry(selfHosted as never, claude as never);

    await registry.generateText({ systemPrompt: 's', userPrompt: 'u' });

    expect(selfHosted.generateText).toHaveBeenCalledTimes(1);
    expect(claude.generateText).not.toHaveBeenCalled();
  });
});

describe('AiProviderRegistry — Phase 9 circuit breaker', () => {
  const claudeUnavailable = fakeProvider('claude-dev-only', false);

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports a clean, closed status when the active provider has never failed', async () => {
    const { provider } = unreliableProvider(0);
    const registry = new AiProviderRegistry(provider as never, claudeUnavailable as never);

    await registry.generateText({ systemPrompt: 's', userPrompt: 'u' });

    const status = registry.getStatus();
    expect(status.circuitState).toBe('closed');
    expect(status.consecutiveFailures).toBe(0);
    expect(status.available).toBe(true);
  });

  it('opens the circuit after 3 consecutive failures and fails fast (no further call to the provider) until the cooldown elapses', async () => {
    const { provider, callCount } = unreliableProvider(Number.MAX_SAFE_INTEGER); // never recovers
    const registry = new AiProviderRegistry(provider as never, claudeUnavailable as never);

    for (let i = 0; i < 3; i += 1) {
      await expect(
        registry.generateText({ systemPrompt: 's', userPrompt: 'u' }),
      ).rejects.toThrow(/simulated connection failure/);
    }
    expect(callCount()).toBe(3);
    expect(registry.getStatus().circuitState).toBe('open');
    expect(registry.isAvailable()).toBe(false);

    // A 4th attempt while the circuit is open must fail immediately WITHOUT
    // ever calling the underlying provider again — this is the actual
    // "resource exhaustion" scenario (Section 8) being closed: a down
    // provider stops being retried on every incoming event.
    await expect(
      registry.generateText({ systemPrompt: 's', userPrompt: 'u' }),
    ).rejects.toThrow(/circuit breaker is open/);
    expect(callCount()).toBe(3); // unchanged — the provider was never called a 4th time
  });

  it('allows exactly one trial call through once the cooldown elapses, and closes the circuit on success', async () => {
    // Fails 3 times (opens the circuit), then the 4th call (the post-cooldown trial) succeeds.
    const { provider, callCount } = unreliableProvider(3);
    const registry = new AiProviderRegistry(provider as never, claudeUnavailable as never);

    for (let i = 0; i < 3; i += 1) {
      await expect(registry.generateText({ systemPrompt: 's', userPrompt: 'u' })).rejects.toThrow();
    }
    expect(registry.getStatus().circuitState).toBe('open');

    jest.advanceTimersByTime(60_001); // past the 60s cooldown

    expect(registry.getStatus().circuitState).toBe('half-open');
    const result = await registry.generateText({ systemPrompt: 's', userPrompt: 'u' });

    expect(result).toBe('recovered response');
    expect(callCount()).toBe(4);
    expect(registry.getStatus().circuitState).toBe('closed');
    expect(registry.getStatus().consecutiveFailures).toBe(0);
    expect(registry.isAvailable()).toBe(true);
  });

  it('reopens the circuit for a fresh cooldown if the post-cooldown trial call also fails', async () => {
    const { provider, callCount } = unreliableProvider(Number.MAX_SAFE_INTEGER);
    const registry = new AiProviderRegistry(provider as never, claudeUnavailable as never);

    for (let i = 0; i < 3; i += 1) {
      await expect(registry.generateText({ systemPrompt: 's', userPrompt: 'u' })).rejects.toThrow();
    }
    jest.advanceTimersByTime(60_001);
    expect(registry.getStatus().circuitState).toBe('half-open');

    await expect(registry.generateText({ systemPrompt: 's', userPrompt: 'u' })).rejects.toThrow(
      /simulated connection failure/,
    );
    expect(callCount()).toBe(4);
    expect(registry.getStatus().circuitState).toBe('open'); // reopened, not closed
  });

  it('never crosses the concurrency cap — an 11th simultaneous call fails fast without ever reaching the provider', async () => {
    let resolveCalls: (() => void)[] = [];
    const provider: AiProvider = {
      providerId: 'self-hosted',
      isAvailable: () => true,
      generateStructured: jest.fn(),
      generateText: jest.fn().mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            resolveCalls.push(() => resolve('ok'));
          }),
      ),
    };
    const registry = new AiProviderRegistry(provider as never, claudeUnavailable as never);

    // Fire 10 calls that never resolve on their own (held open deliberately)
    // to simulate 10 genuinely slow/hung in-flight requests.
    const pending = Array.from({ length: 10 }, () =>
      registry.generateText({ systemPrompt: 's', userPrompt: 'u' }),
    );
    expect(registry.getStatus().inFlightRequests).toBe(10);

    // The 11th concurrent call must fail fast, not queue.
    await expect(
      registry.generateText({ systemPrompt: 's', userPrompt: 'u' }),
    ).rejects.toThrow(/concurrency limit reached/);
    expect(provider.generateText).toHaveBeenCalledTimes(10); // never an 11th real call

    // Let the 10 held-open calls resolve so the test doesn't leak state.
    resolveCalls.forEach((resolve) => resolve());
    await Promise.all(pending);
    expect(registry.getStatus().inFlightRequests).toBe(0);
  });
});

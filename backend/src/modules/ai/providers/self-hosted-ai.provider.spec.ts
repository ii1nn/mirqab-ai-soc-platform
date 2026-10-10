import { ConfigService } from '@nestjs/config';
import { SelfHostedAiProvider } from './self-hosted-ai.provider';

function build(config: Record<string, unknown>): SelfHostedAiProvider {
  const configService = { get: (key: string) => config[key] } as unknown as ConfigService;
  return new SelfHostedAiProvider(configService);
}

/** Simulates a hung/never-responding runtime — the returned fetch promise
 * only ever settles (with a real AbortError, matching actual fetch/undici
 * behavior) when the request's AbortSignal fires, exactly like a genuine
 * network timeout would. */
function mockFetchHangs() {
  const fetchMock = jest.fn().mockImplementation(
    (_url: string, options: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }),
  );
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function mockFetchOnce(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  });
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('SelfHostedAiProvider (Phase 8)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is unavailable when SELF_HOSTED_AI_URL is unset (this environment\'s current, honest default)', () => {
    const provider = build({});
    expect(provider.isAvailable()).toBe(false);
  });

  it('is available once a base URL is configured, and reports a distinct providerId', () => {
    const provider = build({ 'selfHostedAi.baseUrl': 'http://mirqab-ai-runtime:8080' });
    expect(provider.isAvailable()).toBe(true);
    expect(provider.providerId).toBe('self-hosted');
  });

  it('never sends a request when unconfigured — throws locally instead', async () => {
    const provider = build({});
    const fetchMock = mockFetchOnce(200, {});
    await expect(provider.generateText({ systemPrompt: 's', userPrompt: 'u' })).rejects.toThrow(
      /not configured/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls only the configured internal base URL — never a caller-suppliable endpoint', async () => {
    const provider = build({
      'selfHostedAi.baseUrl': 'http://mirqab-ai-runtime:8080',
      'selfHostedAi.model': 'qwen2.5-7b-instruct',
    });
    const fetchMock = mockFetchOnce(200, {
      choices: [{ message: { content: 'plain text answer' } }],
    });

    const result = await provider.generateText({ systemPrompt: 'sys', userPrompt: 'user text' });

    expect(result).toBe('plain text answer');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://mirqab-ai-runtime:8080/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('extracts JSON from a markdown-fenced response (common local-model behavior)', async () => {
    const provider = build({ 'selfHostedAi.baseUrl': 'http://mirqab-ai-runtime:8080' });
    mockFetchOnce(200, {
      choices: [
        {
          message: {
            content:
              'Sure, here is the classification:\n```json\n{"title":"Ransomware","description":"desc text here","severity":"HIGH","mitreTechniqueId":"T1486"}\n```',
          },
        },
      ],
    });

    const schema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
        mitreTechniqueId: { type: 'string' },
      },
      required: ['title', 'description', 'severity', 'mitreTechniqueId'],
    };

    const result = await provider.generateStructured<{ severity: string }>({
      systemPrompt: 'sys',
      userPrompt: 'user',
      schema,
    });

    expect(result.severity).toBe('HIGH');
  });

  it('rejects a response missing a required field rather than returning a partial object', async () => {
    const provider = build({ 'selfHostedAi.baseUrl': 'http://mirqab-ai-runtime:8080' });
    mockFetchOnce(200, {
      choices: [{ message: { content: '{"title":"X"}' } }],
    });

    const schema = {
      type: 'object',
      properties: { title: { type: 'string' }, severity: { type: 'string' } },
      required: ['title', 'severity'],
    };

    await expect(
      provider.generateStructured({ systemPrompt: 's', userPrompt: 'u', schema }),
    ).rejects.toThrow(/missing required field/);
  });

  it('rejects a response whose value violates the enum constraint (a local model hallucinating an invalid severity)', async () => {
    const provider = build({ 'selfHostedAi.baseUrl': 'http://mirqab-ai-runtime:8080' });
    mockFetchOnce(200, {
      choices: [{ message: { content: '{"severity":"URGENT!!!"}' } }],
    });

    const schema = {
      type: 'object',
      properties: { severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] } },
      required: ['severity'],
    };

    await expect(
      provider.generateStructured({ systemPrompt: 's', userPrompt: 'u', schema }),
    ).rejects.toThrow(/invalid value/);
  });

  it('Phase 9: rejects severity:null rather than persisting a null value', async () => {
    const provider = build({ 'selfHostedAi.baseUrl': 'http://mirqab-ai-runtime:8080' });
    mockFetchOnce(200, { choices: [{ message: { content: '{"severity":null}' } }] });

    const schema = {
      type: 'object',
      properties: { severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] } },
      required: ['severity'],
    };

    await expect(
      provider.generateStructured({ systemPrompt: 's', userPrompt: 'u', schema }),
    ).rejects.toThrow(/must be a string/);
  });

  it('Phase 9: rejects severity:999 (a number instead of a string) rather than coercing it', async () => {
    const provider = build({ 'selfHostedAi.baseUrl': 'http://mirqab-ai-runtime:8080' });
    mockFetchOnce(200, { choices: [{ message: { content: '{"severity":999}' } }] });

    const schema = {
      type: 'object',
      properties: { severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] } },
      required: ['severity'],
    };

    await expect(
      provider.generateStructured({ systemPrompt: 's', userPrompt: 'u', schema }),
    ).rejects.toThrow(/must be a string/);
  });

  it('Phase 9: an empty object {} is rejected as missing every required field', async () => {
    const provider = build({ 'selfHostedAi.baseUrl': 'http://mirqab-ai-runtime:8080' });
    mockFetchOnce(200, { choices: [{ message: { content: '{}' } }] });

    const schema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
      },
      required: ['title', 'severity'],
    };

    await expect(
      provider.generateStructured({ systemPrompt: 's', userPrompt: 'u', schema }),
    ).rejects.toThrow(/missing required field/);
  });

  it('Phase 9: rogue fields outside the requested schema (incidentId/deviceId/departmentId/action) pass through parsing but are never required or trusted by the schema contract', async () => {
    // Proves the injection attempt "smuggle a different incidentId/deviceId/
    // departmentId, or an 'action':'ISOLATE_DEVICE' instruction, inside the
    // classification JSON" gets no special handling here — this provider
    // only validates the fields the CALLER declared as its schema
    // (title/description/severity/mitreTechniqueId for classify()). The
    // real protection is that AiService.classify() never reads any field
    // by these names from the result at all (see ai.service.spec.ts) — an
    // extra property surviving JSON.parse is inert, not a capability.
    const provider = build({ 'selfHostedAi.baseUrl': 'http://mirqab-ai-runtime:8080' });
    mockFetchOnce(200, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: 'X',
              severity: 'HIGH',
              incidentId: 'some-other-incident-id',
              deviceId: 'some-other-device-id',
              departmentId: 'some-other-department-id',
              action: 'ISOLATE_DEVICE',
            }),
          },
        },
      ],
    });

    const schema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
      },
      required: ['title', 'severity'],
    };

    const result = await provider.generateStructured<Record<string, unknown>>({
      systemPrompt: 's',
      userPrompt: 'u',
      schema,
    });

    // The rogue fields are present in the raw parsed object (this provider
    // doesn't strip unknown keys) — what matters is nothing downstream ever
    // reads them by name. See ai.service.spec.ts's Phase 9 test for that
    // consumption-side guarantee.
    expect(result.title).toBe('X');
    expect(result.severity).toBe('HIGH');
  });

  it('rejects a non-JSON response instead of returning garbage', async () => {
    const provider = build({ 'selfHostedAi.baseUrl': 'http://mirqab-ai-runtime:8080' });
    mockFetchOnce(200, { choices: [{ message: { content: 'I cannot help with that.' } }] });

    await expect(
      provider.generateStructured({
        systemPrompt: 's',
        userPrompt: 'u',
        schema: { type: 'object', properties: {}, required: [] },
      }),
    ).rejects.toThrow(/did not contain valid JSON/);
  });

  it('propagates a clean error on a non-2xx runtime response rather than silently succeeding', async () => {
    const provider = build({ 'selfHostedAi.baseUrl': 'http://mirqab-ai-runtime:8080' });
    mockFetchOnce(500, {});

    await expect(provider.generateText({ systemPrompt: 's', userPrompt: 'u' })).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it('Phase 9: aborts and rejects a request that exceeds the configured timeout, instead of hanging indefinitely', async () => {
    jest.useFakeTimers();
    try {
      const provider = build({
        'selfHostedAi.baseUrl': 'http://mirqab-ai-runtime:8080',
        'selfHostedAi.timeoutMs': 5_000,
      });
      mockFetchHangs();

      const call = provider.generateText({ systemPrompt: 's', userPrompt: 'u' });
      // Attach a rejection handler immediately so Node doesn't flag this as
      // an unhandled rejection during the time-advance below.
      const assertion = expect(call).rejects.toThrow(/abort/i);

      jest.advanceTimersByTime(5_001);

      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('Phase 9: a fast response well under the timeout resolves normally (no false-positive aborts)', async () => {
    jest.useFakeTimers();
    try {
      const provider = build({
        'selfHostedAi.baseUrl': 'http://mirqab-ai-runtime:8080',
        'selfHostedAi.timeoutMs': 5_000,
      });
      mockFetchOnce(200, { choices: [{ message: { content: 'quick answer' } }] });

      const result = await provider.generateText({ systemPrompt: 's', userPrompt: 'u' });
      expect(result).toBe('quick answer');
    } finally {
      jest.useRealTimers();
    }
  });

  it('Phase 9: rejects a response whose declared Content-Length exceeds the allowed size, rather than buffering an unbounded body', async () => {
    const provider = build({ 'selfHostedAi.baseUrl': 'http://mirqab-ai-runtime:8080' });
    mockFetchOnce(200, {}, { 'content-length': String(2_000_000) });

    await expect(provider.generateText({ systemPrompt: 's', userPrompt: 'u' })).rejects.toThrow(
      /exceeded the allowed size/,
    );
  });
});

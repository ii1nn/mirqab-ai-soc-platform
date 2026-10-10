import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WazuhActiveResponseProvider } from './wazuh-active-response.provider';

describe('WazuhActiveResponseProvider', () => {
  const device = { id: 'device-1', hostname: 'WEB-01', ipAddress: '10.0.0.5' } as never;

  const fullConfig = {
    'wazuh.apiUrl': 'https://wazuh.example.com:55000/',
    'wazuh.apiUser': 'wazuh-wui',
    'wazuh.apiPassword': 'wazuh-password',
    'wazuh.isolationCommand': 'mirqab-isolate',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function build(config: Record<string, string | undefined>) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        WazuhActiveResponseProvider,
        { provide: ConfigService, useValue: { get: (key: string) => config[key] } },
      ],
    }).compile();

    return moduleRef.get(WazuhActiveResponseProvider);
  }

  /** isolate() has several real await hops (auth fetch, agent lookup fetch,
   * dispatch fetch) before it registers the confirmation waiter — poll
   * rather than assuming it's registered the instant isolate() is called. */
  async function reportOnceRegistered(
    provider: WazuhActiveResponseProvider,
    hostname: string,
    success: boolean,
    detail?: string,
  ) {
    for (let i = 0; i < 100; i++) {
      if (provider.reportExecutionResult(hostname, success, detail)) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error(`reportExecutionResult never found a pending waiter for "${hostname}"`);
  }

  function mockFetch(handlers: {
    auth?: unknown;
    agents?: unknown;
    activeResponse?: unknown;
    authOk?: boolean;
    agentsOk?: boolean;
    activeResponseOk?: boolean;
  }) {
    const fetchMock = jest.fn((url: string) => {
      if (url.includes('/security/user/authenticate')) {
        return Promise.resolve({
          ok: handlers.authOk ?? true,
          status: 500,
          json: () => Promise.resolve(handlers.auth ?? { error: 0, data: { token: 'jwt-token' } }),
        });
      }
      if (url.includes('/agents?name=')) {
        return Promise.resolve({
          ok: handlers.agentsOk ?? true,
          status: 500,
          json: () =>
            Promise.resolve(
              handlers.agents ?? {
                error: 0,
                data: { affected_items: [{ id: '007', name: 'WEB-01', status: 'active' }] },
              },
            ),
        });
      }
      if (url.includes('/active-response?agents_list=')) {
        return Promise.resolve({
          ok: handlers.activeResponseOk ?? true,
          status: 500,
          json: () =>
            Promise.resolve(
              handlers.activeResponse ?? {
                error: 0,
                data: { affected_items: [{}], failed_items: [], total_affected_items: 1, total_failed_items: 0 },
              },
            ),
          text: () => Promise.resolve('{"title": "mock error body"}'),
        });
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it('is unavailable when any of the four required settings is missing', async () => {
    expect((await build({})).isAvailable()).toBe(false);
    expect((await build({ 'wazuh.apiUrl': 'https://wazuh.example.com' })).isAvailable()).toBe(false);
    expect(
      (
        await build({
          'wazuh.apiUrl': 'https://wazuh.example.com',
          'wazuh.apiUser': 'u',
          'wazuh.apiPassword': 'p',
          // isolationCommand deliberately omitted — no real AR command registered yet
        })
      ).isAvailable(),
    ).toBe(false);
  });

  it('is available only once all four settings (including the real AR command name) are set', async () => {
    expect((await build(fullConfig)).isAvailable()).toBe(true);
  });

  it('isolate() throws when not configured', async () => {
    const provider = await build({});
    await expect(provider.isolate(device)).rejects.toThrow('not configured');
  });

  it('authenticates, resolves the Wazuh agent by hostname, and triggers the configured Active Response command', async () => {
    const provider = await build(fullConfig);
    const fetchMock = mockFetch({});

    const isolatePromise = provider.isolate(device);
    // Dispatch alone must never resolve isolate() — simulate the agent's own
    // script calling back with real confirmation, exactly like
    // EndpointControlController does.
    await reportOnceRegistered(provider, 'WEB-01', true, 'Isolation genuinely applied.');
    const result = await isolatePromise;

    expect(result).toEqual({ success: true, detail: 'Isolation genuinely applied.' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://wazuh.example.com:55000/security/user/authenticate',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://wazuh.example.com:55000/agents?name=WEB-01',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer jwt-token' }) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://wazuh.example.com:55000/active-response?agents_list=007',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ command: '!mirqab-isolate', arguments: [] }),
      }),
    );
  });

  it('never reports SUCCESS on dispatch acceptance alone — waits for the agent to report a real result', async () => {
    const provider = await build(fullConfig);
    mockFetch({});

    const isolatePromise = provider.isolate(device);
    await reportOnceRegistered(provider, 'WEB-01', false, 'iptables-save failed — no changes made.');
    const result = await isolatePromise;

    expect(result).toEqual({ success: false, detail: 'iptables-save failed — no changes made.' });
  });

  it('records FAILED — never SUCCESS — when no execution confirmation arrives before the timeout', async () => {
    jest.useFakeTimers();
    try {
      const provider = await build(fullConfig);
      mockFetch({});

      const isolatePromise = provider.isolate(device);
      await jest.advanceTimersByTimeAsync(60_000);
      const result = await isolatePromise;

      expect(result.success).toBe(false);
      expect(result.detail).toContain('no execution confirmation callback was received');
    } finally {
      jest.useRealTimers();
    }
  });

  it('reportExecutionResult returns false for a stray callback with no matching pending isolate() call', async () => {
    const provider = await build(fullConfig);
    expect(provider.reportExecutionResult('NOBODY-IS-ISOLATING-THIS-HOST', true)).toBe(false);
  });

  it('throws — never fabricates success — when no Wazuh agent is registered under that hostname', async () => {
    const provider = await build(fullConfig);
    mockFetch({ agents: { error: 0, data: { affected_items: [] } } });

    await expect(provider.isolate(device)).rejects.toThrow(
      'No Wazuh agent is registered under hostname "WEB-01"',
    );
  });

  it('throws when the Wazuh agent is registered but not active', async () => {
    const provider = await build(fullConfig);
    mockFetch({
      agents: { error: 0, data: { affected_items: [{ id: '007', name: 'WEB-01', status: 'disconnected' }] } },
    });

    await expect(provider.isolate(device)).rejects.toThrow('not active');
  });

  it('reports failure rather than success when Wazuh reports failed_items for the Active Response call', async () => {
    const provider = await build(fullConfig);
    mockFetch({
      activeResponse: {
        error: 0,
        data: {
          affected_items: [],
          failed_items: [{ error: { message: 'Agent is not active' } }],
          total_affected_items: 0,
          total_failed_items: 1,
        },
      },
    });

    const result = await provider.isolate(device);
    expect(result.success).toBe(false);
    expect(result.detail).toContain('Agent is not active');
  });

  it('throws on a non-2xx HTTP response from the manager rather than assuming success', async () => {
    const provider = await build(fullConfig);
    mockFetch({ activeResponseOk: false });

    await expect(provider.isolate(device)).rejects.toThrow('HTTP 500');
  });

  it('captures the real response body text in the thrown error — temporary diagnostic for the live HTTP 400', async () => {
    const provider = await build(fullConfig);
    mockFetch({ activeResponseOk: false });

    await expect(provider.isolate(device)).rejects.toThrow('mock error body');
  });
});

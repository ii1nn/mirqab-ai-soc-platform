import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EndpointControlService } from './endpoint-control.service';
import { WazuhActiveResponseProvider } from './wazuh-active-response.provider';

describe('EndpointControlService', () => {
  const device = { id: 'device-1', hostname: 'WEB-01', ipAddress: '10.0.0.5' } as never;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function build(
    config: Record<string, string | undefined>,
  ): Promise<EndpointControlService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EndpointControlService,
        WazuhActiveResponseProvider,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();

    return moduleRef.get(EndpointControlService);
  }

  it('is unavailable when ENDPOINT_CONTROL_API_URL/API_KEY are unset — no automated isolation in this environment', async () => {
    const service = await build({});
    expect(service.isAvailable()).toBe(false);
  });

  it('is unavailable when only one of apiUrl/apiKey is set', async () => {
    const service = await build({ 'endpointControl.apiUrl': 'https://edr.example.com' });
    expect(service.isAvailable()).toBe(false);
  });

  it('isolate() throws when the provider is not configured — callers must never treat this as success', async () => {
    const service = await build({});
    await expect(service.isolate(device)).rejects.toThrow('not configured');
  });

  it('is available and calls the configured provider when both apiUrl and apiKey are set', async () => {
    const service = await build({
      'endpointControl.apiUrl': 'https://edr.example.com/',
      'endpointControl.apiKey': 'secret-key',
    });
    expect(service.isAvailable()).toBe(true);

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, detail: 'Contained' }),
    });
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const result = await service.isolate(device);

    expect(result).toEqual({ success: true, detail: 'Contained' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://edr.example.com/isolate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret-key' }),
      }),
    );
  });

  it('propagates a real failure result from the provider rather than assuming success', async () => {
    const service = await build({
      'endpointControl.apiUrl': 'https://edr.example.com',
      'endpointControl.apiKey': 'secret-key',
    });

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: false, detail: 'Device unreachable' }),
    });
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const result = await service.isolate(device);
    expect(result).toEqual({ success: false, detail: 'Device unreachable' });
  });

  it('throws when the provider responds with a non-2xx HTTP status', async () => {
    const service = await build({
      'endpointControl.apiUrl': 'https://edr.example.com',
      'endpointControl.apiKey': 'secret-key',
    });

    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    await expect(service.isolate(device)).rejects.toThrow('HTTP 503');
  });

  it('prefers Wazuh Active Response over the generic REST provider when both are configured', async () => {
    const config: Record<string, string | undefined> = {
      'endpointControl.apiUrl': 'https://edr.example.com',
      'endpointControl.apiKey': 'secret-key',
      'wazuh.apiUrl': 'https://wazuh.example.com:55000',
      'wazuh.apiUser': 'wazuh-wui',
      'wazuh.apiPassword': 'wazuh-password',
      'wazuh.isolationCommand': 'mirqab-isolate',
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        EndpointControlService,
        WazuhActiveResponseProvider,
        { provide: ConfigService, useValue: { get: (key: string) => config[key] } },
      ],
    }).compile();
    const service = moduleRef.get(EndpointControlService);
    const wazuhProvider = moduleRef.get(WazuhActiveResponseProvider);
    expect(service.isAvailable()).toBe(true);

    const fetchMock = jest.fn((url: string) => {
      if (url.includes('/security/user/authenticate')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ error: 0, data: { token: 't' } }) });
      }
      if (url.includes('/agents?name=')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ error: 0, data: { affected_items: [{ id: '007', name: 'WEB-01', status: 'active' }] } }),
        });
      }
      if (url.includes('/active-response?agents_list=')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              error: 0,
              data: { affected_items: [{}], failed_items: [], total_affected_items: 1, total_failed_items: 0 },
            }),
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const isolatePromise = service.isolate(device);
    // Dispatch acceptance alone must never resolve isolate() — simulate the
    // agent's own script calling back with real confirmation. isolate() has
    // several real await hops before the waiter is registered, so poll
    // rather than assuming it's ready the instant isolate() is called.
    for (let i = 0; i < 100; i++) {
      if (wazuhProvider.reportExecutionResult('WEB-01', true, 'Isolation genuinely applied.')) break;
      await new Promise((resolve) => setImmediate(resolve));
    }
    const result = await isolatePromise;

    expect(result).toEqual({ success: true, detail: 'Isolation genuinely applied.' });
    // The generic EDR provider must never be called once Wazuh is available.
    expect(fetchMock).not.toHaveBeenCalledWith('https://edr.example.com/isolate', expect.anything());
  });
});

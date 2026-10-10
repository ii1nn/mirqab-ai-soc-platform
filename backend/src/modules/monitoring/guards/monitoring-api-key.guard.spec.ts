import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MonitoringApiKeyGuard } from './monitoring-api-key.guard';

function contextWithHeader(header?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: header === undefined ? {} : { 'x-api-key': header } }),
    }),
  } as unknown as ExecutionContext;
}

describe('MonitoringApiKeyGuard', () => {
  const EXPECTED_KEY = 'a-very-long-shared-secret-key-value';
  let guard: MonitoringApiKeyGuard;
  let config: { get: jest.Mock };

  beforeEach(() => {
    config = { get: jest.fn().mockReturnValue(EXPECTED_KEY) };
    guard = new MonitoringApiKeyGuard(config as unknown as ConfigService);
  });

  it('allows a request presenting the exact configured key', () => {
    expect(guard.canActivate(contextWithHeader(EXPECTED_KEY))).toBe(true);
  });

  it('rejects a request with no X-Api-Key header', () => {
    expect(() => guard.canActivate(contextWithHeader(undefined))).toThrow(UnauthorizedException);
  });

  it('rejects a request with a wrong key of the same length', () => {
    const wrongSameLength = 'b'.repeat(EXPECTED_KEY.length);
    expect(() => guard.canActivate(contextWithHeader(wrongSameLength))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a request with a wrong key of a different length', () => {
    expect(() => guard.canActivate(contextWithHeader('short'))).toThrow(UnauthorizedException);
  });

  it('rejects every request when no key is configured', () => {
    config.get.mockReturnValue(undefined);
    expect(() => guard.canActivate(contextWithHeader(EXPECTED_KEY))).toThrow(UnauthorizedException);
  });
});

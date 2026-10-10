import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

// Avoid real network connections in tests — a genuine ioredis client would
// try (and retry) an actual TCP connect to whatever REDIS_URL is given.
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue(undefined),
    duplicate: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      quit: jest.fn().mockResolvedValue(undefined),
    })),
  }));
});

describe('RedisService', () => {
  describe('when REDIS_URL is unset', () => {
    let service: RedisService;

    beforeEach(() => {
      service = new RedisService({ get: () => undefined } as unknown as ConfigService);
    });

    it('reports not configured', () => {
      expect(service.isConfigured()).toBe(false);
    });

    it('returns null instead of throwing', () => {
      expect(service.createAdapterClients()).toBeNull();
    });
  });

  describe('when REDIS_URL is set', () => {
    let service: RedisService;

    beforeEach(() => {
      service = new RedisService({
        get: () => 'redis://localhost:6379',
      } as unknown as ConfigService);
    });

    afterEach(async () => {
      await service.onModuleDestroy();
    });

    it('reports configured', () => {
      expect(service.isConfigured()).toBe(true);
    });

    it('returns a pub/sub client pair', () => {
      const clients = service.createAdapterClients();
      expect(clients).not.toBeNull();
      expect(clients?.pubClient).toBeDefined();
      expect(clients?.subClient).toBeDefined();
      expect(clients?.pubClient).not.toBe(clients?.subClient);
    });
  });
});

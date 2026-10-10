import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Optional by design — REDIS_URL unset means every Redis-backed feature
 * degrades to its single-instance behavior instead of failing to boot, the
 * same fallback philosophy ClaudeService uses for the AI engine (see
 * modules/ai/claude/claude.service.ts). Currently the only consumer is
 * RealtimeGateway's cross-instance broadcast adapter (see
 * modules/websocket/realtime.gateway.ts) — provisioned since Phase 8's
 * Docker Compose stack, wired up here in Phase 9.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private pubClient?: Redis;
  private subClient?: Redis;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('redis.url'));
  }

  /**
   * Returns a connected pub/sub client pair, or null if REDIS_URL isn't set.
   * Two separate connections are required — once a client issues SUBSCRIBE,
   * ioredis (like the Redis protocol itself) forbids any other command on
   * that same connection, so the publisher and subscriber can't share one.
   */
  createAdapterClients(): { pubClient: Redis; subClient: Redis } | null {
    const url = this.config.get<string>('redis.url');
    if (!url) {
      return null;
    }

    this.pubClient = new Redis(url);
    this.subClient = this.pubClient.duplicate();

    this.pubClient.on('error', (error) =>
      this.logger.error(`Redis pub client error: ${error.message}`),
    );
    this.subClient.on('error', (error) =>
      this.logger.error(`Redis sub client error: ${error.message}`),
    );

    return { pubClient: this.pubClient, subClient: this.subClient };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.pubClient?.quit(), this.subClient?.quit()]);
  }
}

import { AiController } from './ai.controller';

/**
 * Phase 11: verifies the `@Throttle` decorator applied to `POST /ai/analyze`
 * carries the intended configuration, without exercising the live
 * request-counting behavior of @nestjs/throttler's ThrottlerGuard itself —
 * that guard's own counting/429 logic is the framework's responsibility,
 * already used (and live-verified this phase) on `/auth/login` via the
 * identical `@Throttle` mechanism. `@nestjs/throttler`'s `Throttle()`
 * decorator stores its options as reflect-metadata directly on the handler
 * function under 'THROTTLER:LIMIT'/'THROTTLER:TTL' + throttler name (see
 * node_modules/@nestjs/throttler/dist/throttler.decorator.js's
 * setThrottlerMetadata — not part of the package's public API surface, so
 * these key strings are pinned by direct inspection of that file rather
 * than an exported constant).
 */
describe('AiController — /ai/analyze throttle configuration', () => {
  const THROTTLER_NAME = 'default';

  it('limits POST /ai/analyze to 20 requests per 60-second window', () => {
    const limit = Reflect.getMetadata(
      `THROTTLER:LIMIT${THROTTLER_NAME}`,
      AiController.prototype.analyze,
    );
    const ttl = Reflect.getMetadata(
      `THROTTLER:TTL${THROTTLER_NAME}`,
      AiController.prototype.analyze,
    );

    expect(limit).toBe(20);
    expect(ttl).toBe(60_000);
  });

  it('does not apply the same tight limit to read-only incident routes', () => {
    // Sanity check that the decorator was placed on `analyze` specifically,
    // not accidentally hoisted onto the whole controller (which would also
    // throttle every GET /ai/incidents* route at 20/60s).
    const limit = Reflect.getMetadata(
      `THROTTLER:LIMIT${THROTTLER_NAME}`,
      AiController.prototype.listIncidents,
    );
    expect(limit).toBeUndefined();
  });

  // Phase 16 (performance/scale review): generateReport also calls the
  // AI-provider layer (AiService.generateAnalystReport → generateText()) —
  // the same resource this section's own /ai/analyze throttle protects —
  // but had no matching limit until this phase.
  it('limits POST /ai/incidents/:id/analyst-report to 20 requests per 60-second window', () => {
    const limit = Reflect.getMetadata(
      `THROTTLER:LIMIT${THROTTLER_NAME}`,
      AiController.prototype.generateReport,
    );
    const ttl = Reflect.getMetadata(
      `THROTTLER:TTL${THROTTLER_NAME}`,
      AiController.prototype.generateReport,
    );

    expect(limit).toBe(20);
    expect(ttl).toBe(60_000);
  });
});

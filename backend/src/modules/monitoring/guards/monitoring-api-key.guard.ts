import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Gates the /monitoring/* ingestion endpoints. These are called by headless
 * Wazuh/Suricata/Sysmon forwarders, not dashboard users, so the global JWT
 * guard doesn't apply (routes are marked @Public()) — this is the only auth
 * they get. Comparison is constant-time so a mistyped key can't be brute-forced
 * via response-time measurement.
 */
@Injectable()
export class MonitoringApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const presented: unknown = request.headers['x-api-key'];
    const expected = this.config.get<string>('monitoring.ingestApiKey');

    if (typeof presented !== 'string' || !presented || !expected) {
      throw new UnauthorizedException('Missing or invalid X-Api-Key');
    }

    const presentedBuf = Buffer.from(presented);
    const expectedBuf = Buffer.from(expected);

    // timingSafeEqual throws on unequal-length buffers, so the length check
    // must come first — it leaks only length, never byte content, which is
    // the standard tradeoff for this comparison.
    const matches =
      presentedBuf.length === expectedBuf.length && timingSafeEqual(presentedBuf, expectedBuf);

    if (!matches) {
      throw new UnauthorizedException('Missing or invalid X-Api-Key');
    }

    return true;
  }
}

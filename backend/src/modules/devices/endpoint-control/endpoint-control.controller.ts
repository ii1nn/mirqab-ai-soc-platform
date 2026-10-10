import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/decorators/public.decorator';
import { MonitoringApiKeyGuard } from '../../monitoring/guards/monitoring-api-key.guard';
import { ActiveResponseResultDto } from './dto/active-response-result.dto';
import { WazuhActiveResponseProvider } from './wazuh-active-response.provider';

/**
 * Called by the isolation/unisolation script running ON THE AGENT — not the
 * SOC Dashboard, not the Wazuh manager — to report whether it actually ran.
 * This is the real evidence WazuhActiveResponseProvider.isolate() waits on
 * before it will ever report SUCCESS; see that class's doc comment. Gated
 * the same way as the /monitoring/* ingestion endpoints (headless caller,
 * shared X-Api-Key, no JWT) since this is also a headless agent-side caller,
 * not a dashboard user — reuses MonitoringApiKeyGuard rather than inventing
 * a second auth mechanism.
 */
@Controller('devices/endpoint-control')
@Public()
@UseGuards(MonitoringApiKeyGuard)
@Throttle({ default: { limit: 100, ttl: 60_000 } })
export class EndpointControlController {
  constructor(private readonly wazuhActiveResponse: WazuhActiveResponseProvider) {}

  @Post('active-response-result')
  @HttpCode(HttpStatus.NO_CONTENT)
  reportResult(@Body() dto: ActiveResponseResultDto): void {
    this.wazuhActiveResponse.reportExecutionResult(dto.hostname, dto.success, dto.detail);
  }
}

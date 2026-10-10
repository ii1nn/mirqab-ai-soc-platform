import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../../common/decorators/roles.decorator';
import { WazuhSamplesService } from './wazuh-samples.service';

/**
 * SOC-facing demo control, unlike MonitoringController's headless-agent
 * routes — requires normal analyst auth (global JwtAuthGuard applies, no
 * @Public() here), not the monitoring API key.
 */
@Controller('monitoring/wazuh-samples')
@Roles(Role.ADMIN, Role.SECURITY_ANALYST)
export class WazuhSamplesController {
  constructor(private readonly wazuhSamplesService: WazuhSamplesService) {}

  @Post('seed')
  @HttpCode(HttpStatus.OK)
  seed() {
    return this.wazuhSamplesService.seed();
  }
}

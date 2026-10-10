import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../../common/decorators/roles.decorator';
import { EvtxSamplesService } from './evtx-samples.service';

/**
 * SOC-facing demo control, unlike MonitoringController's headless-agent
 * routes — requires normal analyst auth (global JwtAuthGuard applies, no
 * @Public() here), not the monitoring API key. Mirrors WazuhSamplesController.
 */
@Controller('monitoring/evtx-samples')
@Roles(Role.ADMIN, Role.SECURITY_ANALYST)
export class EvtxSamplesController {
  constructor(private readonly evtxSamplesService: EvtxSamplesService) {}

  @Post('seed')
  @HttpCode(HttpStatus.OK)
  seed() {
    return this.evtxSamplesService.seed();
  }
}

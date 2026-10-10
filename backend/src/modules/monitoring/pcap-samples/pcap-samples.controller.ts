import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PcapSamplesService } from './pcap-samples.service';

/** SOC-facing demo control — requires normal analyst auth, mirrors WazuhSamplesController/LoghubSamplesController. */
@Controller('monitoring/pcap-samples')
@Roles(Role.ADMIN, Role.SECURITY_ANALYST)
export class PcapSamplesController {
  constructor(private readonly pcapSamplesService: PcapSamplesService) {}

  @Post('seed')
  @HttpCode(HttpStatus.OK)
  seed() {
    return this.pcapSamplesService.seed();
  }
}

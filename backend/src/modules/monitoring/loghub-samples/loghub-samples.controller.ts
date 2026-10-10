import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../../common/decorators/roles.decorator';
import { LoghubSamplesService } from './loghub-samples.service';

/** SOC-facing demo control — requires normal analyst auth, mirrors WazuhSamplesController. */
@Controller('monitoring/loghub-samples')
@Roles(Role.ADMIN, Role.SECURITY_ANALYST)
export class LoghubSamplesController {
  constructor(private readonly loghubSamplesService: LoghubSamplesService) {}

  @Post('seed')
  @HttpCode(HttpStatus.OK)
  seed() {
    return this.loghubSamplesService.seed();
  }
}

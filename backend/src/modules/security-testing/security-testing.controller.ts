import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { SecurityTestingService } from './security-testing.service';

/**
 * Requirement #32: "Do not expose offensive exploitation capabilities to
 * normal SOC users." ADMIN-only — SECURITY_ANALYST/IT_TECHNICIAN, who can
 * reach every other AI/incident endpoint, cannot reach this one.
 */
@Controller('security-testing')
@Roles(Role.ADMIN)
export class SecurityTestingController {
  constructor(private readonly securityTestingService: SecurityTestingService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  run() {
    return this.securityTestingService.runAll();
  }
}

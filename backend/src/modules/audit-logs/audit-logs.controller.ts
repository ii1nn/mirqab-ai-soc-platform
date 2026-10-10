import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditLogsService } from './audit-logs.service';

@Controller('audit-logs')
@Roles(Role.ADMIN, Role.SECURITY_ANALYST)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.auditLogsService.findAll(user);
  }
}

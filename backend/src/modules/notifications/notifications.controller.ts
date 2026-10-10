import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { NotificationsService } from './notifications.service';

/** Same three SOC-facing roles as the incident endpoints (AiController) —
 * EMPLOYEE accounts have no incident access, so they get no incident
 * notifications either. Row-level scoping is applied in the service. */
@Controller('notifications')
@Roles(Role.ADMIN, Role.SECURITY_ANALYST, Role.IT_TECHNICIAN)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.listForUser(user);
  }
}

import { Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { PoliciesService } from './policies.service';

@Controller('policies')
@Roles(Role.ADMIN, Role.SECURITY_ANALYST, Role.IT_TECHNICIAN)
export class PoliciesController {
  constructor(private readonly policiesService: PoliciesService) {}

  @Get()
  findAll() {
    return this.policiesService.findAll();
  }

  @Patch(':id/toggle')
  toggle(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.policiesService.toggle(id, user.email);
  }
}

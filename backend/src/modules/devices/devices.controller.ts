import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DeviceAccessGuard } from '../../common/guards/device-access.guard';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { DevicesService } from './devices.service';

/** Requirement #30 (OWASP API#1): DeviceAccessGuard adds the object-level
 * department check on top of RolesGuard's role-only check — see the guard. */
@Controller('devices')
@Roles(Role.ADMIN, Role.SECURITY_ANALYST, Role.IT_TECHNICIAN)
@UseGuards(DeviceAccessGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query('departmentId') departmentId?: string) {
    return this.devicesService.findAll(user, departmentId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.devicesService.findById(id);
  }
}

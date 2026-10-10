import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { UpdateUserDepartmentDto } from './dto/update-user-department.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UserEntity } from './entities/user.entity';
import { UsersService } from './users.service';

/** Backs the SOC Dashboard's User Management page. Admin-only (RolesGuard reads this class-level metadata for every route here). */
@Controller('users')
@Roles(Role.ADMIN)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  @Get()
  async findAll(@CurrentUser() admin: AuthenticatedUser): Promise<UserEntity[]> {
    const users = await this.usersService.findAll(admin);
    return users.map((user) => new UserEntity(user));
  }

  @Patch(':id/status')
  async setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<UserEntity> {
    const user = await this.usersService.setActive(id, dto.isActive, admin);
    await this.auditLogs.log(
      admin.email,
      `${dto.isActive ? 'Reactivated' : 'Deactivated'} user ${user.email}`,
      id,
    );
    return new UserEntity(user);
  }

  /** Requirement #30: assigns which department an IT_TECHNICIAN's case access is scoped to. */
  @Patch(':id/department')
  async setDepartment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDepartmentDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<UserEntity> {
    const user = await this.usersService.setDepartment(id, dto.departmentId ?? null, admin);
    await this.auditLogs.log(
      admin.email,
      dto.departmentId
        ? `Assigned user ${user.email} to department ${dto.departmentId}`
        : `Cleared department assignment for user ${user.email}`,
      id,
    );
    return new UserEntity(user);
  }
}

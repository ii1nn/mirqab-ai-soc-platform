import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import { assertDepartmentAccess, assertOrganizationAccess } from './department-access.util';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * Requirement #30 (OWASP API#1) — the same object-level check as
 * IncidentAccessGuard/TicketAccessGuard, applied to DevicesController.
 * Device carries departmentId directly (not denormalized from elsewhere).
 *
 * Phase 2.6B: also enforces the organization boundary, checked for every
 * role (not just IT_TECHNICIAN) — see assertOrganizationAccess's own
 * comment for why organization scoping has no role-based exemption the
 * way department scoping does.
 */
@Injectable()
export class DeviceAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const deviceId: string | undefined = request.params?.id;
    if (!deviceId) {
      return true;
    }

    const user: AuthenticatedUser | undefined = request.user;
    if (!user) {
      return false;
    }

    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { departmentId: true, organizationId: true },
    });
    if (!device) {
      return true;
    }

    try {
      assertOrganizationAccess(user, device.organizationId);
      if (user.role === Role.IT_TECHNICIAN) {
        assertDepartmentAccess(user, device.departmentId);
      }
      return true;
    } catch (error) {
      await this.auditLogs.log(
        user.email,
        `Access denied: attempted to access device outside their organization/department`,
        deviceId,
      );
      throw error;
    }
  }
}

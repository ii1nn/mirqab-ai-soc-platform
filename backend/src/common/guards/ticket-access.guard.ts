import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import { assertDepartmentAccess, assertOrganizationAccess } from './department-access.util';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * Requirement #30 (OWASP API#1) — the same object-level check as
 * IncidentAccessGuard, applied to TicketsController. Tickets already carry
 * a denormalized departmentId (copied from the parent incident at creation
 * — see the Ticket model comment), so this needs no extra join.
 */
@Injectable()
export class TicketAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const ticketId: string | undefined = request.params?.id;
    if (!ticketId) {
      return true;
    }

    const user: AuthenticatedUser | undefined = request.user;
    if (!user) {
      return false;
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { departmentId: true, organizationId: true },
    });
    if (!ticket) {
      return true;
    }

    try {
      assertOrganizationAccess(user, ticket.organizationId);
      if (user.role === Role.IT_TECHNICIAN) {
        assertDepartmentAccess(user, ticket.departmentId);
      }
      return true;
    } catch (error) {
      await this.auditLogs.log(
        user.email,
        `Access denied: attempted to access ticket outside their organization/department`,
        ticketId,
      );
      throw error;
    }
  }
}

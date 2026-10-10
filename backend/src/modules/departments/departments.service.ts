import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { organizationScopeWhere } from '../../common/guards/department-access.util';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Phase 2.6B: organization-scoped — Company A must never see Company
   * B's departments. Every role is scoped (departments have no org-wide
   * exemption the way ADMIN/SECURITY_ANALYST get for department-level
   * scoping within their own org). */
  findAll(user: AuthenticatedUser) {
    return this.prisma.department.findMany({
      where: organizationScopeWhere(user),
      orderBy: { name: 'asc' },
    });
  }

  /** Phase 2.6B: a department id alone is not sufficient to cross the
   * tenant boundary — the caller's own organization is still checked
   * before the row is returned, even though this is a direct-by-id fetch
   * (no controller-level guard exists for Department the way Device/
   * Incident/Ticket have one, since this endpoint was read-only and
   * org-agnostic until now). */
  async findById(id: string, user: AuthenticatedUser) {
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    if (!user.organizationId || department.organizationId !== user.organizationId) {
      throw new ForbiddenException('You do not have access to this department.');
    }
    return department;
  }
}

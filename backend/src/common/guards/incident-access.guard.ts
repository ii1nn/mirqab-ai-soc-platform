import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import { assertDepartmentAccess, assertOrganizationAccess } from './department-access.util';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * Requirement #30 (OWASP API Security #1 — Broken Object Level
 * Authorization): every `AiController` route that takes an incident `:id`
 * param runs through this guard after RolesGuard. Role alone ("are you a
 * SECURITY_ANALYST") was previously the only check — any authenticated
 * privileged user could read or act on *any* case just by knowing its
 * UUID. This adds the missing object-level check.
 *
 * ADMIN and SECURITY_ANALYST keep org-wide access — a real SOC analyst
 * needs to correlate incidents across departments, and gating that would
 * break the actual job the role exists to do. IT_TECHNICIAN — the
 * lowest-privilege role that still reaches this controller (see
 * AuthService.signup) — is scoped to their own department's cases only.
 *
 * Fail-closed: an IT_TECHNICIAN with no department assigned is denied
 * every department-scoped case (`null !== null` is never true against a
 * departmented incident), not silently granted everything. An incident
 * with no department at all (departmentId null — can happen when a device
 * couldn't be resolved at ingestion) is treated as accessible to any
 * authenticated user in this controller, since there's no department to
 * scope it to either way.
 */
@Injectable()
export class IncidentAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const incidentId: string | undefined = request.params?.id;
    if (!incidentId) {
      // Routes without an :id param (list/create endpoints) aren't object-scoped.
      return true;
    }

    const user: AuthenticatedUser | undefined = request.user;
    if (!user) {
      return false;
    }

    // Phase 2.6B: organization scoping applies to every role (no
    // org-wide-role exemption — see assertOrganizationAccess), so this can
    // no longer early-return true for ADMIN/SECURITY_ANALYST the way the
    // department-only check used to. A single fetch below now covers both
    // checks' data needs.
    const incident = await this.prisma.incident.findUnique({
      where: { id: incidentId },
      select: { departmentId: true, organizationId: true },
    });
    // Let a 404 come from the service layer for a missing incident rather
    // than a 403 here.
    if (!incident) {
      return true;
    }

    try {
      assertOrganizationAccess(user, incident.organizationId);
      if (user.role === Role.IT_TECHNICIAN) {
        assertDepartmentAccess(user, incident.departmentId);
      }
      return true;
    } catch (error) {
      // Phase 6: authorization denials are themselves security-relevant
      // events (Section 9's "access denied" completeness requirement) —
      // logged here, at the single shared point every :id-scoped denial
      // for this resource passes through, rather than in
      // assertDepartmentAccess/assertOrganizationAccess themselves (kept
      // untouched — they have no audit dependency and their own
      // well-established test coverage).
      await this.auditLogs.log(
        user.email,
        `Access denied: attempted to access incident outside their organization/department`,
        incidentId,
      );
      throw error;
    }
  }
}

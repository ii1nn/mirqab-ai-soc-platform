import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { organizationScopeWhere } from '../../common/guards/department-access.util';
import { REALTIME_EVENTS } from '../websocket/events';

@Injectable()
export class AuditLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Phase 2.6B: `organizationId` is resolved server-side, never accepted
   * from any caller-supplied client value. Most call sites don't pass it
   * explicitly — it's looked up here from the acting user's own `email`
   * (already a unique-indexed column), the same "re-resolve live, don't
   * trust anything cached" principle already used for role/departmentId
   * elsewhere. Call sites that already have a more specific, already-loaded
   * organization in scope (e.g. AiService's incident-related audit calls,
   * which know the *incident's* organizationId directly) pass it explicitly
   * as the 4th argument to skip the extra lookup and use the more precise
   * value. A synthetic system actor (`'system:*'`, no matching User row)
   * resolves to `null` when not passed explicitly — never guessed, matching
   * this phase's explicit "do not assign an organization by guessing"
   * requirement for these exact rows.
   */
  async log(
    actorEmail: string,
    action: string,
    target?: string,
    organizationId?: string | null,
  ): Promise<void> {
    const resolvedOrganizationId =
      organizationId !== undefined
        ? organizationId
        : (await this.prisma.user.findUnique({ where: { email: actorEmail }, select: { organizationId: true } }))
            ?.organizationId ?? null;

    const auditLog = await this.prisma.auditLog.create({
      data: { actorEmail, action, target, organizationId: resolvedOrganizationId },
    });
    this.events.emit(REALTIME_EVENTS.AUDIT_LOG_CREATED, { auditLog });
  }

  /** Phase 2.6B: organization-scoped — an audit entry with no resolvable
   * organization (see log()'s doc comment) is excluded here by design,
   * same reasoning as organizationScopeWhere for every other resource:
   * never surfaced as if it belonged to every organization. */
  findAll(user: AuthenticatedUser, limit = 200) {
    return this.prisma.auditLog.findMany({
      where: organizationScopeWhere(user),
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** Every audit entry logged against one case (target = Incident.id — see
   * every `auditLogs.log(actor, message, incidentId)` call site). Backs the
   * Case PDF report's audit trail section. Not independently org-scoped
   * here — every caller already reached this incident's own id through
   * IncidentAccessGuard (which enforces the organization boundary), so
   * this is always called in a context where that check already passed. */
  findByTarget(target: string) {
    return this.prisma.auditLog.findMany({ where: { target }, orderBy: { createdAt: 'asc' } });
  }
}

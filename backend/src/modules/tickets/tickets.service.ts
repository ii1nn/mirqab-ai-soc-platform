import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TicketStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { departmentScopeWhere, organizationScopeWhere } from '../../common/guards/department-access.util';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { REALTIME_EVENTS } from '../websocket/events';

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly events: EventEmitter2,
  ) {}

  /** Phase 1 RBAC/IDOR remediation: previously `findMany({ take: 200 })`
   * with no `where` at all — every IT_TECHNICIAN saw every department's
   * tickets. TicketAccessGuard never covered this route (no `:id` param);
   * departmentScopeWhere() applies the same department rule the guard
   * already enforces on the `:id` routes below.
   *
   * Phase 2.6B: organizationScopeWhere() is ANDed in alongside it (both
   * return plain objects with non-overlapping keys, so a spread composes
   * them safely) — a ticket outside the caller's organization is excluded
   * even before department scope is considered, for every role. */
  findAll(user: AuthenticatedUser) {
    return this.prisma.ticket.findMany({
      where: { ...departmentScopeWhere(user), ...organizationScopeWhere(user) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async updateStatus(id: string, status: TicketStatus, actorEmail: string) {
    await this.assertExists(id);
    const updated = await this.prisma.ticket.update({ where: { id }, data: { status } });
    await this.auditLogs.log(actorEmail, `Set ticket status to "${status}"`, id);
    this.events.emit(REALTIME_EVENTS.TICKET_UPDATED, { ticket: updated });
    return updated;
  }

  async reassign(id: string, assignee: string, actorEmail: string) {
    await this.assertExists(id);
    const updated = await this.prisma.ticket.update({ where: { id }, data: { assignee } });
    await this.auditLogs.log(actorEmail, `Reassigned ticket to ${assignee}`, id);
    this.events.emit(REALTIME_EVENTS.TICKET_UPDATED, { ticket: updated });
    return updated;
  }

  private async assertExists(id: string): Promise<void> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
  }
}

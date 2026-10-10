import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { REALTIME_EVENTS } from '../websocket/events';

@Injectable()
export class PoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly events: EventEmitter2,
  ) {}

  findAll() {
    return this.prisma.policy.findMany({ orderBy: { name: 'asc' } });
  }

  async toggle(id: string, actorEmail: string) {
    const policy = await this.prisma.policy.findUnique({ where: { id } });
    if (!policy) {
      throw new NotFoundException('Policy not found');
    }

    const updated = await this.prisma.policy.update({
      where: { id },
      data: { enabled: !policy.enabled },
    });

    await this.auditLogs.log(
      actorEmail,
      `${updated.enabled ? 'Enabled' : 'Disabled'} policy "${updated.name}"`,
      id,
    );
    this.events.emit(REALTIME_EVENTS.POLICY_UPDATED, { policy: updated });

    return updated;
  }
}

import { Module } from '@nestjs/common';
import { TicketAccessGuard } from '../../common/guards/ticket-access.guard';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [TicketsController],
  providers: [TicketsService, TicketAccessGuard],
  exports: [TicketsService],
})
export class TicketsModule {}

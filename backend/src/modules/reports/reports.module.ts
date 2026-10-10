import { Module } from '@nestjs/common';
import { IncidentAccessGuard } from '../../common/guards/incident-access.guard';
import { AiModule } from '../ai/ai.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DevicesModule } from '../devices/devices.module';
import { CaseReportService } from './case-report.service';
import { ReportsController } from './reports.controller';
import { WeeklyReportDataService } from './weekly-report-data.service';
import { WeeklyReportScheduler } from './weekly-report.scheduler';
import { WeeklyReportService } from './weekly-report.service';

@Module({
  imports: [AiModule, AuditLogsModule, DevicesModule],
  controllers: [ReportsController],
  providers: [
    CaseReportService,
    IncidentAccessGuard,
    WeeklyReportDataService,
    WeeklyReportService,
    WeeklyReportScheduler,
  ],
})
export class ReportsModule {}

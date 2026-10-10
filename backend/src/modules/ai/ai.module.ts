import { Module } from '@nestjs/common';
import { IncidentAccessGuard } from '../../common/guards/incident-access.guard';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DevicesModule } from '../devices/devices.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AgentAuditService } from './agents/agent-audit.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AutoResponsePolicyService } from './auto-response/auto-response-policy.service';
import { CaseIdService } from './case-id/case-id.service';
import { MitreAttackModule } from './mitre-attack/mitre-attack.module';
import { AiProvidersModule } from './providers/providers.module';
import { ResponseSlaService } from './response-sla/response-sla.service';
import { RiskPredictionService } from './risk-prediction/risk-prediction.service';
import { SimilarityEngineModule } from './similarity-engine/similarity-engine.module';
import { TrainingBenchmarkService } from './training-data/training-benchmark.service';

@Module({
  imports: [
    AiProvidersModule,
    MitreAttackModule,
    SimilarityEngineModule,
    AuditLogsModule,
    DevicesModule,
    NotificationsModule,
  ],
  controllers: [AiController],
  providers: [
    AiService,
    RiskPredictionService,
    TrainingBenchmarkService,
    CaseIdService,
    AgentAuditService,
    IncidentAccessGuard,
    ResponseSlaService,
    AutoResponsePolicyService,
  ],
  exports: [AiService],
})
export class AiModule {}

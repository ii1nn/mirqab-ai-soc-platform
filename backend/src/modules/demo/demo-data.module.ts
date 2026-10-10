import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { DemoDataService } from './demo-data.service';

/** Evaluator demo bootstrap — inert unless MIRQAB_DEMO_DATA=true (infra/demo). */
@Module({
  imports: [AiModule, MonitoringModule],
  providers: [DemoDataService],
})
export class DemoDataModule {}

import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { MitreAttackModule } from '../ai/mitre-attack/mitre-attack.module';
import { SecurityTestingController } from './security-testing.controller';
import { SecurityTestingService } from './security-testing.service';

@Module({
  imports: [AiModule, MitreAttackModule],
  controllers: [SecurityTestingController],
  providers: [SecurityTestingService],
})
export class SecurityTestingModule {}

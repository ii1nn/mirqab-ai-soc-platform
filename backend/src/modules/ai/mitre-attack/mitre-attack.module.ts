import { Module } from '@nestjs/common';
import { MitreMappingService } from './mitre-mapping.service';

@Module({
  providers: [MitreMappingService],
  exports: [MitreMappingService],
})
export class MitreAttackModule {}

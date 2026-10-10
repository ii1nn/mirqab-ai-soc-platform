import { Module } from '@nestjs/common';
import { SimilarityEngineService } from './similarity-engine.service';

@Module({
  providers: [SimilarityEngineService],
  exports: [SimilarityEngineService],
})
export class SimilarityEngineModule {}

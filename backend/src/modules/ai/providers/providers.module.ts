import { Module } from '@nestjs/common';
import { ClaudeModule } from '../claude/claude.module';
import { AiProviderRegistry } from './ai-provider.registry';
import { SelfHostedAiProvider } from './self-hosted-ai.provider';

@Module({
  imports: [ClaudeModule],
  providers: [SelfHostedAiProvider, AiProviderRegistry],
  exports: [AiProviderRegistry],
})
export class AiProvidersModule {}

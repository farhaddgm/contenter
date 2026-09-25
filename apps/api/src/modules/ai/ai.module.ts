import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { SamplesCoreModule } from '../samples/samples-core.module';
import { AiExecutor } from './ai-executor.service';
import { AiJobsService } from './ai-jobs.service';
import { ContextLoader } from './context-loader.service';
import { AI_PROVIDER, type AiProvider } from './provider/ai-provider';
import { AnthropicProvider } from './provider/anthropic.provider';
import { MockProvider } from './provider/mock.provider';
import { PromptService } from './prompts/prompt.service';
import { AnalyzeSampleRunner } from './runners/analyze-sample.runner';
import { BuildProfileRunner } from './runners/build-profile.runner';
import { GenerateContentRunner, ReviseContentRunner } from './runners/content.runners';
import { IdeateRunner } from './runners/ideate.runner';
import { AI_RUNNERS } from './runners/runner';
import { SmartChatRunner } from './runners/smart-chat.runner';

const RUNNERS = [
  AnalyzeSampleRunner,
  BuildProfileRunner,
  IdeateRunner,
  GenerateContentRunner,
  ReviseContentRunner,
  SmartChatRunner,
];

@Global()
@Module({
  imports: [SamplesCoreModule],
  providers: [
    {
      provide: AI_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env): AiProvider =>
        env.AI_PROVIDER === 'mock'
          ? new MockProvider()
          : new AnthropicProvider(env.ANTHROPIC_API_KEY, env.AI_REFUSAL_FALLBACK),
    },
    PromptService,
    AiExecutor,
    ContextLoader,
    AiJobsService,
    ...RUNNERS,
    { provide: AI_RUNNERS, inject: RUNNERS, useFactory: (...runners) => runners },
  ],
  exports: [AiJobsService, PromptService, ContextLoader],
})
export class AiModule {}

import { Global, Module } from '@nestjs/common';
import { SamplesCoreModule } from '../samples/samples-core.module';
import { AiExecutor } from './ai-executor.service';
import { AiJobsService } from './ai-jobs.service';
import { ContextLoader } from './context-loader.service';
import { AiProviderRegistry } from './provider/provider-registry';
import { PromptService } from './prompts/prompt.service';
import { AnalyzeSampleRunner } from './runners/analyze-sample.runner';
import { BuildProfileRunner } from './runners/build-profile.runner';
import {
  BusinessBuildRunner,
  BusinessDiscoverRunner,
  BusinessSuggestRunner,
} from './runners/business.runners';
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
  BusinessDiscoverRunner,
  BusinessBuildRunner,
  BusinessSuggestRunner,
];

@Global()
@Module({
  imports: [SamplesCoreModule],
  providers: [
    AiProviderRegistry,
    PromptService,
    AiExecutor,
    ContextLoader,
    AiJobsService,
    ...RUNNERS,
    { provide: AI_RUNNERS, inject: RUNNERS, useFactory: (...runners) => runners },
  ],
  exports: [AiJobsService, PromptService, ContextLoader, AiProviderRegistry],
})
export class AiModule {}

import { Global, Module } from '@nestjs/common';
import { SamplesCoreModule } from '../samples/samples-core.module';
import { AiAlertsService } from './ai-alerts.service';
import { AiBatchService } from './batch/ai-batch.service';
import { BudgetController, BudgetService } from './budget.service';
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
import {
  BusinessAssetAnalyzeRunner,
  BusinessAuditRunner,
  BusinessReviseRunner,
} from './runners/business-extra.runners';
import {
  GenerateContentRunner,
  RepurposeContentRunner,
  ReviseContentRunner,
} from './runners/content.runners';
import { IdeateRunner } from './runners/ideate.runner';
import { LearnFromEditsRunner } from './runners/learn-from-edits.runner';
import { AI_RUNNERS } from './runners/runner';
import { SmartChatRunner } from './runners/smart-chat.runner';

const RUNNERS = [
  AnalyzeSampleRunner,
  BuildProfileRunner,
  IdeateRunner,
  GenerateContentRunner,
  ReviseContentRunner,
  RepurposeContentRunner,
  LearnFromEditsRunner,
  SmartChatRunner,
  BusinessDiscoverRunner,
  BusinessBuildRunner,
  BusinessSuggestRunner,
  BusinessReviseRunner,
  BusinessAssetAnalyzeRunner,
  BusinessAuditRunner,
];

@Global()
@Module({
  imports: [SamplesCoreModule],
  controllers: [BudgetController],
  providers: [
    AiProviderRegistry,
    AiAlertsService,
    AiBatchService,
    BudgetService,
    PromptService,
    AiExecutor,
    ContextLoader,
    AiJobsService,
    ...RUNNERS,
    { provide: AI_RUNNERS, inject: RUNNERS, useFactory: (...runners) => runners },
  ],
  exports: [
    AiJobsService,
    PromptService,
    ContextLoader,
    AiProviderRegistry,
    AiAlertsService,
    BudgetService,
  ],
})
export class AiModule {}

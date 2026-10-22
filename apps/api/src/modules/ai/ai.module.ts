import { Global, Module } from '@nestjs/common';
import { SamplesCoreModule } from '../samples/samples-core.module';
import { AiAlertsService } from './ai-alerts.service';
import { AiBatchService } from './batch/ai-batch.service';
import { BudgetController, BudgetService } from './budget.service';
import { AiExecutor } from './ai-executor.service';
import { AiJobsService } from './ai-jobs.service';
import { ContextLoader } from './context-loader.service';
import { AiKeysService } from './provider/ai-keys.service';
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
import { BusinessOfferingsExtractRunner } from './runners/business-offerings.runner';
import { BusinessStyleBuildRunner } from './runners/business-style.runner';
import { EmbedReferenceRunner } from './runners/embed-reference.runner';
import { IdeateRunner } from './runners/ideate.runner';
import { LearnFromEditsRunner } from './runners/learn-from-edits.runner';
import { AI_RUNNERS } from './runners/runner';
import { SemanticRetriever } from './semantic/semantic.service';
import { SmartChatRunner } from './runners/smart-chat.runner';

const RUNNERS = [
  AnalyzeSampleRunner,
  BuildProfileRunner,
  IdeateRunner,
  GenerateContentRunner,
  ReviseContentRunner,
  RepurposeContentRunner,
  LearnFromEditsRunner,
  EmbedReferenceRunner,
  SmartChatRunner,
  BusinessDiscoverRunner,
  BusinessBuildRunner,
  BusinessSuggestRunner,
  BusinessReviseRunner,
  BusinessAssetAnalyzeRunner,
  BusinessAuditRunner,
  BusinessStyleBuildRunner,
  BusinessOfferingsExtractRunner,
];

@Global()
@Module({
  imports: [SamplesCoreModule],
  controllers: [BudgetController],
  providers: [
    AiKeysService,
    AiProviderRegistry,
    AiAlertsService,
    AiBatchService,
    BudgetService,
    SemanticRetriever,
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
    AiKeysService,
    AiProviderRegistry,
    AiAlertsService,
    BudgetService,
    SemanticRetriever,
  ],
})
export class AiModule {}

import { Controller, Get, Injectable, Module, NotFoundException, Param, Query } from '@nestjs/common';
import {
  buildContextReport,
  calibrateRatio,
  ContextPreviewQuerySchema,
  parseModelRef,
  RATIO_SAMPLE_JOBS,
  type AiJobType,
  type ContextPreviewQuery,
  type ContextReport,
  type ContextTarget,
  type Platform,
} from '@contenter/shared';
import { AccessService, BusinessScoped } from '../../common/access';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { buildBusinessParts, type BusinessForPrompt } from '../ai/context';
import { ContextLoader } from '../ai/context-loader.service';
import { priceFor } from '../ai/pricing';
import { BusinessApi } from '../businesses/business-api';
import { SettingsService } from '../settings/settings.module';

/** The task whose model, price and token ratio stand for each kind of preview. */
const TASK_OF: Record<ContextTarget, AiJobType> = {
  DRAFT: 'GENERATE_CONTENT',
  IDEATE: 'IDEATE',
  PROFILE: 'BUSINESS_SUGGEST',
};

/**
 * What the model reads about a business (docs/66-business-context-preview.md): the blocks of the
 * `business` prompt variable with their size and a rough token and cost estimate. It builds the
 * blocks with the same functions the jobs use and calls no model. It never indexes documents or
 * calls the embeddings vendor, so reading it costs nothing.
 */
@Injectable()
export class ContextPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly businesses: BusinessApi,
    private readonly loader: ContextLoader,
    private readonly settings: SettingsService,
  ) {}

  async preview(
    businessId: string,
    query: ContextPreviewQuery,
    user: AuthUser,
  ): Promise<ContextReport> {
    const { target = 'DRAFT', topicId } = query;
    const profile = await this.businesses.promptProfile(businessId);
    if (!profile) throw new NotFoundException('Business not found');

    // a project of this business that the caller can see, or one indistinguishable 404
    let topic: { id: string; platform: Platform } | null = null;
    if (topicId) {
      const visible = this.access.visibleTopics(user);
      topic = await this.prisma.topic.findFirst({
        where: { id: topicId, businessId, ...(visible ? { AND: [visible] } : {}) },
        select: { id: true, platform: true },
      });
      if (!topic) throw new NotFoundException('Not found');
    }

    // profile jobs read the profile alone; ideas and drafts read it through the project
    let source: BusinessForPrompt = profile;
    if (topic && target !== 'PROFILE') {
      const loaded = await this.loader.business(
        topic.id,
        target === 'DRAFT' ? { platform: topic.platform, format: 'POST' } : undefined,
        { semantic: false, focus: true },
      );
      if (loaded) source = loaded;
    }
    const parts = buildBusinessParts(source, { includeEmpty: target === 'PROFILE' });

    const { model: ref } = await this.settings.modelFor(TASK_OF[target]);
    const modelId = parseModelRef(ref).model;
    const price = priceFor(ref);
    const ratio = calibrateRatio(await this.samples(modelId));

    return buildContextReport({
      target,
      topicId: topic?.id ?? null,
      blocks: parts,
      ratio,
      model: ref,
      // what a job costs is for admins; the sizes are for everyone who can read the profile
      inputPricePerMillion: user.role === 'ADMIN' && price ? price.input : null,
      needsTopic: target !== 'PROFILE' && !topic,
    });
  }

  /** Recent finished jobs of the model whose prompt size was recorded, as (chars, tokens). */
  private async samples(modelId: string) {
    const rows = await this.prisma.aiJob.findMany({
      where: {
        status: 'SUCCEEDED',
        promptChars: { gt: 0 },
        inputTokens: { gt: 0 },
        model: { startsWith: modelId },
      },
      orderBy: { finishedAt: 'desc' },
      take: RATIO_SAMPLE_JOBS,
      select: { promptChars: true, inputTokens: true, cacheReadTokens: true },
    });
    return rows.map((r) => ({
      chars: r.promptChars ?? 0,
      tokens: r.inputTokens + r.cacheReadTokens,
    }));
  }
}

@Controller()
export class ContextPreviewController {
  constructor(private readonly preview: ContextPreviewService) {}

  @BusinessScoped('business')
  @Get('businesses/:id/context-preview')
  get(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(ContextPreviewQuerySchema)) query: ContextPreviewQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.preview.preview(id, query, user);
  }
}

@Module({ controllers: [ContextPreviewController], providers: [ContextPreviewService] })
export class ContextPreviewModule {}

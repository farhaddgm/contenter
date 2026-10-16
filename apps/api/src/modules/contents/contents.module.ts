import {
  BadRequestException,
  ConflictException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  analyzeReadability,
  checkContentQuality,
  checkTerms,
  ContentListQuerySchema,
  defaultFormatFor,
  variantAnglesFor,
  effectivePlatform,
  RepurposeContentSchema,
  EditContentVersionSchema,
  GenerateContentSchema,
  ReviseContentSchema,
  UpdateContentSchema,
  type EditContentVersionInput,
  type GenerateContentInput,
  type RepurposeContentInput,
  type ReviseContentInput,
  type UpdateContentInput,
} from '@contenter/shared';
import { z } from 'zod';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { AccessService, TopicScoped } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { paginate, toPage } from '../../common/pagination';
import { AuditService } from '../audit/audit.service';
import { AiJobsService } from '../ai/ai-jobs.service';
import { SettingsService } from '../settings/settings.module';
import { StyleFitService } from '../style-fit/style-fit.module';
import { CoverageService } from '../pillars/coverage.module';
import { SimilarityService } from '../similarity/similarity.module';
import { ChecklistsService } from '../checklists/checklists.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { ReviewsService } from '../reviews/reviews.service';
import { TAG_SELECT } from '../tags/tag-select';
import { buildContentOrderBy, buildContentWhere } from './content-filters';
import { MetricsController, MetricsService } from './metrics.service';

const PUBLISHED_FROZEN = 'The content is published; unpublish it before changing it';

const LIST_INCLUDE = {
  topic: { select: { id: true, title: true, platform: true } },
  idea: { select: { id: true, title: true } },
  currentVersion: { select: { id: true, version: true, selfCheck: true, createdAt: true } },
  tags: { select: TAG_SELECT, orderBy: { name: 'asc' } },
  campaign: { select: { id: true, name: true, status: true } },
} satisfies Prisma.ContentInclude;

@Injectable()
export class ContentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: AiJobsService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly reviews: ReviewsService,
    private readonly checklists: ChecklistsService,
    private readonly settings: SettingsService,
    private readonly similarity: SimilarityService,
    private readonly coverage: CoverageService,
    private readonly styleFit: StyleFitService,
  ) {}

  async list(query: z.infer<typeof ContentListQuerySchema>, user: AuthUser) {
    const where = buildContentWhere(query, this.access.visibleTopics(user));
    const [items, total] = await this.prisma.$transaction([
      this.prisma.content.findMany({
        where,
        orderBy: buildContentOrderBy(query.sort, query.order),
        include: LIST_INCLUDE,
        ...paginate(query),
      }),
      this.prisma.content.count({ where }),
    ]);
    return toPage(items, total, query);
  }

  async get(id: string) {
    const c = await this.prisma.content.findUnique({
      where: { id },
      include: {
        topic: { select: { id: true, title: true, platform: true } },
        idea: { select: { id: true, title: true } },
        currentVersion: true,
        versions: { orderBy: { version: 'desc' } },
        tags: { select: TAG_SELECT, orderBy: { name: 'asc' } },
        campaign: { select: { id: true, name: true, status: true } },
        submittedBy: { select: { id: true, name: true } },
        source: { select: { id: true, title: true, platform: true, status: true } },
        repurposed: {
          select: { id: true, title: true, platform: true, format: true, status: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!c) throw new NotFoundException('Content not found');
    return c;
  }

  /**
   * Content with its versions plus the checks done by code, never by the model: the brand
   * terminology check of the current version (`checkTerms`), the pre-publish quality gate
   * (`checkContentQuality`: platform limits, key-fact numbers, Persian typography, docs/41), and
   * the review workflow: what the caller may do now and the history.
   */
  async detail(id: string, user: AuthUser) {
    const base = await this.get(id);
    const [review, reviews] = await Promise.all([
      this.reviews.info(base, user),
      this.reviews.history(id),
    ]);
    const c = { ...base, review, reviews };
    const v = c.currentVersion;
    if (!v)
      return {
        ...c,
        termIssues: [],
        quality: null,
        readability: null,
        similarity: null,
        styleFit: null,
        checklist: await this.checklists.forContent(id),
      };
    const topic = await this.prisma.topic.findUnique({
      where: { id: c.topicId },
      select: {
        business: {
          select: {
            terms: { where: { isActive: true } },
            facts: { where: { isActive: true } },
          },
        },
        businessId: true,
      },
    });
    const terms = topic?.business?.terms ?? [];
    const text = [v.title, v.body, v.hashtags.join(' '), v.cta].join('\n');
    const platform = effectivePlatform(c, c.topic);
    const quality = checkContentQuality({
      title: v.title,
      body: v.body,
      hashtags: v.hashtags,
      cta: v.cta,
      platform,
      format: c.format,
      terms,
      facts: topic?.business?.facts ?? [],
    });
    return {
      ...c,
      termIssues: terms.length ? checkTerms(text, terms) : [],
      quality,
      similarity: await this.similarity.forContent(user, {
        id: c.id,
        topicId: c.topicId,
        businessId: topic?.businessId ?? null,
        ideaId: c.ideaId,
        sourceContentId: c.sourceContentId,
        variantGroupId: c.variantGroupId,
        title: v.title,
        body: v.body,
      }),
      styleFit: await this.styleFit.forContent(user, {
        topicId: c.topicId,
        businessId: topic?.businessId ?? null,
        body: v.body,
        hashtags: v.hashtags,
        cta: v.cta,
      }),
      readability: analyzeReadability({
        body: v.body,
        cta: v.cta,
        platform,
        settings: await this.settings.getReadability(),
      }),
      checklist: await this.checklists.forContent(id, quality),
    };
  }

  /** Creates the content shell (status GENERATING) and queues the AI draft. */
  async generate(topicId: string, input: GenerateContentInput, user: AuthUser) {
    const data = GenerateContentSchema.parse(input);
    await this.prisma.topic.findUniqueOrThrow({ where: { id: topicId } });
    const idea = data.ideaId
      ? await this.prisma.idea.findFirst({
          where: { id: data.ideaId, topicId },
          include: { tags: { select: { id: true } } },
        })
      : null;
    if (data.ideaId && !idea) throw new BadRequestException('Idea does not belong to this topic');

    // Several drafts: N empty shells that share a group, one job each, each with its own fixed angle
    // (docs/51-draft-variants.md). One draft is the old, single path.
    const { maxVariants } = await this.settings.getVariants();
    if (data.variants > maxVariants) {
      throw new BadRequestException(`At most ${maxVariants} drafts can be written at once`);
    }
    const angles = data.variants > 1 ? variantAnglesFor(data.variants) : [];
    const variantGroupId = angles.length ? randomUUID() : null;
    const made: { contentId: string; jobId: string; angle: string | null }[] = [];
    for (let i = 0; i < Math.max(1, angles.length); i++) {
      const angle = angles[i] ?? null;
      const content = await this.prisma.content.create({
        data: {
          topicId,
          ideaId: idea?.id ?? null,
          title: idea?.title ?? data.brief!.slice(0, 120),
          brief: data.brief ?? '',
          format: data.format ?? idea?.format ?? 'POST',
          status: 'GENERATING',
          createdById: user.id,
          variantGroupId,
          variantAngle: angle,
          // a content written from a tagged idea starts with the idea's tags
          ...(idea?.tags.length ? { tags: { connect: idea.tags } } : {}),
        },
      });
      const job = await this.jobs.enqueue({
        type: 'GENERATE_CONTENT',
        targetType: 'Content',
        targetId: content.id,
        topicId,
        input: { ...data, ...(angle ? { variantAngle: angle } : {}) },
        userId: user.id,
        economy: data.economy,
      });
      await this.prisma.content.update({ where: { id: content.id }, data: { lastJobId: job.id } });
      made.push({ contentId: content.id, jobId: job.id, angle });
    }
    // `jobId` / `contentId` stay the first draft's, as before; `variants` lists them all
    return { jobId: made[0]!.jobId, contentId: made[0]!.contentId, variants: made };
  }

  async revise(id: string, input: ReviseContentInput, user: AuthUser) {
    const content = await this.get(id);
    if (content.status === 'GENERATING')
      throw new BadRequestException('A generation is already in progress');
    if (!content.currentVersionId) throw new BadRequestException('Nothing to revise yet');
    if (content.publishedAt) throw new ConflictException(PUBLISHED_FROZEN);
    // the revision replaces the reviewed text: back to DRAFT first, so the history shows why
    await this.reviews.resetAfterEdit(this.prisma, id, user.id);
    await this.prisma.content.update({ where: { id }, data: { status: 'GENERATING' } });
    const job = await this.jobs.enqueue({
      type: 'REVISE_CONTENT',
      targetType: 'Content',
      targetId: id,
      topicId: content.topicId,
      input: { feedback: input.feedback },
      userId: user.id,
    });
    await this.prisma.content.update({ where: { id }, data: { lastJobId: job.id } });
    return { jobId: job.id, contentId: id };
  }

  /** Manual edit by an editor → new ADMIN version. */
  async editVersion(id: string, input: EditContentVersionInput, user: AuthUser) {
    const data = EditContentVersionSchema.parse(input);
    const content = await this.get(id);
    if (content.status === 'GENERATING')
      throw new BadRequestException('Wait for the running generation to finish');
    if (content.publishedAt) throw new ConflictException(PUBLISHED_FROZEN);
    await this.prisma.$transaction(async (tx) => {
      const last = await tx.contentVersion.findFirst({
        where: { contentId: id },
        orderBy: { version: 'desc' },
      });
      const v = await tx.contentVersion.create({
        data: { contentId: id, version: (last?.version ?? 0) + 1, source: 'ADMIN', ...data },
      });
      await tx.content.update({
        where: { id },
        data: { currentVersionId: v.id, title: data.title },
      });
      await this.reviews.resetAfterEdit(tx, id, user.id);
    });
    this.audit.log({
      userId: user.id,
      action: 'content.edit',
      entityType: 'Content',
      entityId: id,
    });
    return this.get(id);
  }

  async restoreVersion(id: string, versionId: string, user: AuthUser) {
    const v = await this.prisma.contentVersion.findFirst({
      where: { id: versionId, contentId: id },
    });
    if (!v) throw new NotFoundException('Version not found');
    const frozen = await this.prisma.content.findUnique({
      where: { id },
      select: { publishedAt: true },
    });
    if (frozen?.publishedAt) throw new ConflictException(PUBLISHED_FROZEN);
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.content.findUnique({
        where: { id },
        select: { currentVersionId: true },
      });
      await tx.content.update({
        where: { id },
        data: { currentVersionId: v.id, title: v.title },
      });
      // restoring the version that is already current changes no text
      if (before?.currentVersionId !== v.id) await this.reviews.resetAfterEdit(tx, id, user.id);
    });
    this.audit.log({
      userId: user.id,
      action: 'content.restore_version',
      entityType: 'Content',
      entityId: id,
      meta: { version: v.version },
    });
    return this.get(id);
  }

  /**
   * Writes the content again for other platforms: one new content (and one queued AI job) per
   * target. The new contents start empty and GENERATING; the runner fills them in.
   */
  async repurpose(id: string, input: RepurposeContentInput, user: AuthUser) {
    const data = RepurposeContentSchema.parse(input);
    const source = await this.prisma.content.findUnique({
      where: { id },
      include: { tags: { select: { id: true } } },
    });
    if (!source) throw new NotFoundException('Content not found');
    if (!source.currentVersionId || source.status === 'GENERATING') {
      throw new BadRequestException('There is no finished draft to adapt yet');
    }

    const items: { contentId: string; jobId: string; platform: string; format: string }[] = [];
    for (const target of data.targets) {
      const format = target.format ?? defaultFormatFor(target.platform);
      const content = await this.prisma.content.create({
        data: {
          topicId: source.topicId,
          sourceContentId: source.id,
          platform: target.platform,
          format,
          title: source.title,
          brief: data.notes,
          status: 'GENERATING',
          // same campaign and tags as the original
          campaignId: source.campaignId,
          tags: source.tags.length ? { connect: source.tags } : undefined,
          createdById: user.id,
        },
      });
      const job = await this.jobs.enqueue({
        type: 'REPURPOSE_CONTENT',
        targetType: 'Content',
        targetId: content.id,
        topicId: source.topicId,
        input: { platform: target.platform, format, notes: data.notes, sourceContentId: source.id },
        userId: user.id,
        economy: data.economy,
      });
      await this.prisma.content.update({ where: { id: content.id }, data: { lastJobId: job.id } });
      items.push({ contentId: content.id, jobId: job.id, platform: target.platform, format });
    }
    this.audit.log({
      userId: user.id,
      action: 'content.repurpose',
      entityType: 'Content',
      entityId: id,
      meta: { targets: items.map((i) => `${i.platform}:${i.format}`) },
    });
    return { items };
  }

  async update(id: string, input: UpdateContentInput, user: AuthUser) {
    if (input.status) {
      // every status change is a review step with its own rules and history
      throw new BadRequestException('Change the status with POST /contents/:id/review/:action');
    }
    if (input.campaignId) {
      const content = await this.prisma.content.findUnique({
        where: { id },
        select: { topicId: true },
      });
      const campaign = await this.prisma.campaign.findFirst({
        where: { id: input.campaignId, topicId: content?.topicId ?? '' },
        select: { id: true },
      });
      if (!campaign) throw new BadRequestException('Campaign does not belong to this topic');
    }
    if (input.pillarId) {
      const content = await this.prisma.content.findUnique({
        where: { id },
        select: { topicId: true },
      });
      await this.coverage.assertForTopic(content?.topicId ?? '', input.pillarId);
    }
    await this.prisma.content.update({ where: { id }, data: input });
    this.audit.log({
      userId: user.id,
      action: 'content.update',
      entityType: 'Content',
      entityId: id,
      meta: input,
    });
    return this.get(id);
  }

  async remove(id: string, user: AuthUser) {
    await this.prisma.content.delete({ where: { id } });
    this.audit.log({
      userId: user.id,
      action: 'content.delete',
      entityType: 'Content',
      entityId: id,
    });
  }
}

@Controller()
export class ContentsController {
  constructor(private readonly contents: ContentsService) {}

  @Get('contents')
  list(
    @Query(new ZodValidationPipe(ContentListQuerySchema))
    query: z.infer<typeof ContentListQuerySchema>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contents.list(query, user);
  }

  @TopicScoped('topic', 'topicId')
  @Post('topics/:topicId/contents/generate')
  @HttpCode(202)
  generate(
    @Param('topicId') topicId: string,
    @Body(new ZodValidationPipe(GenerateContentSchema)) body: GenerateContentInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contents.generate(topicId, body, user);
  }

  @TopicScoped('content')
  @Get('contents/:id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.contents.detail(id, user);
  }

  @TopicScoped('content')
  @Patch('contents/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateContentSchema)) body: UpdateContentInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contents.update(id, body, user);
  }

  @TopicScoped('content')
  @Post('contents/:id/repurpose')
  @HttpCode(202)
  repurpose(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RepurposeContentSchema)) body: RepurposeContentInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contents.repurpose(id, body, user);
  }

  @TopicScoped('content')
  @Post('contents/:id/revise')
  @HttpCode(202)
  revise(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviseContentSchema)) body: ReviseContentInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contents.revise(id, body, user);
  }

  @TopicScoped('content')
  @Put('contents/:id/current')
  edit(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(EditContentVersionSchema)) body: EditContentVersionInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contents.editVersion(id, body, user);
  }

  @TopicScoped('content')
  @Post('contents/:id/versions/:versionId/restore')
  restore(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contents.restoreVersion(id, versionId, user);
  }

  @TopicScoped('content')
  @Delete('contents/:id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.contents.remove(id, user);
  }
}

@Module({
  imports: [ReviewsModule],
  controllers: [ContentsController, MetricsController],
  providers: [ContentsService, MetricsService],
  exports: [ContentsService],
})
export class ContentsModule {}

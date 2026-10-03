import {
  BadRequestException,
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
import { Prisma } from '@prisma/client';
import {
  checkTerms,
  ContentListQuerySchema,
  EditContentVersionSchema,
  GenerateContentSchema,
  ReviseContentSchema,
  UpdateContentSchema,
  type EditContentVersionInput,
  type GenerateContentInput,
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

const LIST_INCLUDE = {
  topic: { select: { id: true, title: true } },
  idea: { select: { id: true, title: true } },
  currentVersion: { select: { id: true, version: true, selfCheck: true, createdAt: true } },
} satisfies Prisma.ContentInclude;

@Injectable()
export class ContentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: AiJobsService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  async list(query: z.infer<typeof ContentListQuerySchema>, user: AuthUser) {
    const visible = this.access.visibleTopics(user);
    const where: Prisma.ContentWhereInput = {
      ...(visible ? { topic: visible } : {}),
      ...(query.topicId ? { topicId: query.topicId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.content.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
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
        topic: { select: { id: true, title: true } },
        idea: { select: { id: true, title: true } },
        currentVersion: true,
        versions: { orderBy: { version: 'desc' } },
      },
    });
    if (!c) throw new NotFoundException('Content not found');
    return c;
  }

  /**
   * Content with its versions plus the brand terminology check of the current version: the
   * linked business's USE/AVOID terms matched by code (checkTerms), never by the model.
   */
  async detail(id: string) {
    const c = await this.get(id);
    const v = c.currentVersion;
    if (!v) return { ...c, termIssues: [] };
    const topic = await this.prisma.topic.findUnique({
      where: { id: c.topicId },
      select: { business: { select: { terms: { where: { isActive: true } } } } },
    });
    const terms = topic?.business?.terms ?? [];
    const text = [v.title, v.body, v.hashtags.join(' '), v.cta].join('\n');
    return { ...c, termIssues: terms.length ? checkTerms(text, terms) : [] };
  }

  /** Creates the content shell (status GENERATING) and queues the AI draft. */
  async generate(topicId: string, input: GenerateContentInput, user: AuthUser) {
    const data = GenerateContentSchema.parse(input);
    await this.prisma.topic.findUniqueOrThrow({ where: { id: topicId } });
    const idea = data.ideaId
      ? await this.prisma.idea.findFirst({ where: { id: data.ideaId, topicId } })
      : null;
    if (data.ideaId && !idea) throw new BadRequestException('Idea does not belong to this topic');

    const content = await this.prisma.content.create({
      data: {
        topicId,
        ideaId: idea?.id ?? null,
        title: idea?.title ?? data.brief!.slice(0, 120),
        brief: data.brief ?? '',
        format: data.format ?? idea?.format ?? 'POST',
        status: 'GENERATING',
        createdById: user.id,
      },
    });
    const job = await this.jobs.enqueue({
      type: 'GENERATE_CONTENT',
      targetType: 'Content',
      targetId: content.id,
      topicId,
      input: data,
      userId: user.id,
    });
    await this.prisma.content.update({ where: { id: content.id }, data: { lastJobId: job.id } });
    return { jobId: job.id, contentId: content.id };
  }

  async revise(id: string, input: ReviseContentInput, user: AuthUser) {
    const content = await this.get(id);
    if (content.status === 'GENERATING')
      throw new BadRequestException('A generation is already in progress');
    if (!content.currentVersionId) throw new BadRequestException('Nothing to revise yet');
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
    await this.prisma.content.update({
      where: { id },
      data: { currentVersionId: v.id, title: v.title },
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

  async update(id: string, input: UpdateContentInput, user: AuthUser) {
    if (input.status === 'GENERATING' || input.status === 'FAILED') {
      throw new BadRequestException('Status is managed by the system');
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
  get(@Param('id') id: string) {
    return this.contents.detail(id);
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
  controllers: [ContentsController],
  providers: [ContentsService],
})
export class ContentsModule {}

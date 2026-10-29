import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
  CreatePrincipleSchema,
  CreateTopicSchema,
  SetSamplesSkippedSchema,
  TopicListQuerySchema,
  UpdatePrincipleSchema,
  UpdateTopicSchema,
  type CreatePrincipleInput,
  type CreateTopicInput,
  type SetSamplesSkippedInput,
  type UpdatePrincipleInput,
  type UpdateTopicInput,
} from '@contenter/shared';
import { z } from 'zod';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth.decorators';
import { AccessService, TopicScoped } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { paginate, toPage } from '../../common/pagination';
import { AuditService } from '../audit/audit.service';
import { BusinessApi } from '../businesses/business-api';

const COUNTS = {
  _count: { select: { samples: true, ideas: true, contents: true, profiles: true } },
  business: { select: { id: true, name: true } },
  style: { select: { id: true, name: true } },
  offering: { select: { id: true, name: true } },
  segment: { select: { id: true, name: true } },
};

@Injectable()
export class TopicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly businesses: BusinessApi,
  ) {}

  async list(query: z.infer<typeof TopicListQuerySchema>, user: AuthUser) {
    const visible = this.access.visibleTopics(user);
    const where: Prisma.TopicWhereInput = {
      ...(visible ? { AND: [visible] } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.businessId ? { businessId: query.businessId } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.topic.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        include: { ...COUNTS, ...this.access.memberInclude(user) },
        ...paginate(query),
      }),
      this.prisma.topic.count({ where }),
    ]);
    return toPage(
      items.map((t) => this.access.withAccess(user, t)),
      total,
      query,
    );
  }

  async get(id: string, user?: AuthUser) {
    const topic = await this.prisma.topic.findUnique({
      where: { id },
      include: { ...COUNTS, ...(user ? this.access.memberInclude(user) : {}) },
    });
    if (!topic) throw new NotFoundException('Topic not found');
    return user ? this.access.withAccess(user, topic) : topic;
  }

  /** A topic may only be linked to an existing business the user can see (docs/17). */
  private async assertBusiness(businessId: string | null | undefined, user: AuthUser) {
    if (!businessId) return;
    if (!(await this.access.accessTo(user, 'business', businessId))) {
      throw new BadRequestException('Business not found');
    }
  }

  /** A project may only use a built and confirmed style of its own business (docs/64). */
  private async assertStyle(businessId: string | null | undefined, styleId: string | null | undefined) {
    if (!styleId) return;
    if (!businessId || !(await this.businesses.styleForPrompt(businessId, styleId))) {
      throw new BadRequestException('Style not found, not built yet or not confirmed by the admin');
    }
  }

  /** A project may only focus on an offering and an audience of its own business (docs/73). */
  private async assertFocus(
    businessId: string | null | undefined,
    offeringId: string | null | undefined,
    segmentId: string | null | undefined,
  ) {
    if (!offeringId && !segmentId) return;
    if (!businessId) throw new BadRequestException('Choose a business before choosing an offering or audience');
    if (offeringId && !(await this.businesses.hasOffering(businessId, offeringId))) {
      throw new BadRequestException('Offering not found in this business');
    }
    if (segmentId && !(await this.businesses.hasSegment(businessId, segmentId))) {
      throw new BadRequestException('Audience not found in this business');
    }
  }

  async create(input: CreateTopicInput, user: AuthUser) {
    const data = CreateTopicSchema.parse(input);
    await this.assertBusiness(data.businessId, user);
    await this.assertStyle(data.businessId, data.styleId);
    await this.assertFocus(data.businessId, data.offeringId, data.segmentId);
    const topic = await this.prisma.topic.create({ data: { ...data, createdById: user.id } });
    this.audit.log({
      userId: user.id,
      action: 'topic.create',
      entityType: 'Topic',
      entityId: topic.id,
    });
    return topic;
  }

  async update(id: string, input: UpdateTopicInput, user: AuthUser) {
    const data = UpdateTopicSchema.parse(input);
    const current = await this.prisma.topic.findUnique({
      where: { id },
      select: { businessId: true, styleId: true, offeringId: true, segmentId: true },
    });
    // only a new link is checked, so editing a topic linked to a hidden business still works
    if (data.businessId !== undefined && data.businessId !== current?.businessId) {
      await this.assertBusiness(data.businessId, user);
    }
    const businessId = data.businessId === undefined ? current?.businessId : data.businessId;
    const businessChanged = businessId !== current?.businessId;
    // a style is checked when it changes and again when the business under it changes
    if (data.styleId && (data.styleId !== current?.styleId || businessChanged)) {
      await this.assertStyle(businessId, data.styleId);
    }
    // another business (or none) cannot keep the old business's style, offering or audience
    const dropStyle = businessChanged && data.styleId === undefined;
    const dropOffering = businessChanged && data.offeringId === undefined;
    const dropSegment = businessChanged && data.segmentId === undefined;
    if (
      (data.offeringId && (data.offeringId !== current?.offeringId || businessChanged)) ||
      (data.segmentId && (data.segmentId !== current?.segmentId || businessChanged))
    ) {
      await this.assertFocus(businessId, data.offeringId, data.segmentId);
    }
    const topic = await this.prisma.topic.update({
      where: { id },
      data: {
        ...data,
        ...(dropStyle ? { styleId: null } : {}),
        ...(dropOffering ? { offeringId: null } : {}),
        ...(dropSegment ? { segmentId: null } : {}),
      },
    });
    this.audit.log({
      userId: user.id,
      action: 'topic.update',
      entityType: 'Topic',
      entityId: id,
      meta: input,
    });
    return topic;
  }

  /**
   * Sample contents are optional. Skipping settles the sample steps and content is produced from
   * the business documents and the documents attached to the project (docs/19-optional-samples.md).
   * Idempotent: skipping twice keeps the first timestamp.
   */
  async setSamplesSkipped(id: string, { skipped }: SetSamplesSkippedInput, user: AuthUser) {
    const current = await this.prisma.topic.findUnique({
      where: { id },
      select: { samplesSkippedAt: true },
    });
    if (!current) throw new NotFoundException('Topic not found');
    if (!!current.samplesSkippedAt === skipped) return this.get(id, user);
    await this.prisma.topic.update({
      where: { id },
      data: { samplesSkippedAt: skipped ? new Date() : null },
    });
    this.audit.log({
      userId: user.id,
      action: skipped ? 'topic.samples_skip' : 'topic.samples_resume',
      entityType: 'Topic',
      entityId: id,
    });
    return this.get(id, user);
  }

  async remove(id: string, user: AuthUser) {
    await this.prisma.topic.delete({ where: { id } });
    this.audit.log({ userId: user.id, action: 'topic.delete', entityType: 'Topic', entityId: id });
  }

  // ----- principles (topicId = null → global) -----

  listPrinciples(topicId: string | null) {
    return this.prisma.principle.findMany({
      where: { topicId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createPrinciple(topicId: string | null, input: CreatePrincipleInput, user: AuthUser) {
    if (topicId) await this.get(topicId);
    const p = await this.prisma.principle.create({
      data: { ...CreatePrincipleSchema.parse(input), topicId },
    });
    this.audit.log({
      userId: user.id,
      action: 'principle.create',
      entityType: 'Principle',
      entityId: p.id,
      meta: { topicId },
    });
    return p;
  }

  /** Global principles are admin-only; topic principles are editable by editors. */
  private async assertPrincipleAccess(id: string, user: AuthUser) {
    const p = await this.prisma.principle.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Principle not found');
    if (p.topicId === null && user.role !== 'ADMIN')
      throw new ForbiddenException('Global principles are admin-only');
  }

  async updatePrinciple(id: string, input: UpdatePrincipleInput, user: AuthUser) {
    await this.assertPrincipleAccess(id, user);
    const p = await this.prisma.principle.update({
      where: { id },
      data: UpdatePrincipleSchema.parse(input),
    });
    this.audit.log({
      userId: user.id,
      action: 'principle.update',
      entityType: 'Principle',
      entityId: id,
    });
    return p;
  }

  async removePrinciple(id: string, user: AuthUser) {
    await this.assertPrincipleAccess(id, user);
    await this.prisma.principle.delete({ where: { id } });
    this.audit.log({
      userId: user.id,
      action: 'principle.delete',
      entityType: 'Principle',
      entityId: id,
    });
  }
}

@Controller('topics')
export class TopicsController {
  constructor(private readonly topics: TopicsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(TopicListQuerySchema)) query: z.infer<typeof TopicListQuerySchema>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.topics.list(query, user);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateTopicSchema)) body: CreateTopicInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.topics.create(body, user);
  }

  @TopicScoped('topic')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.topics.get(id, user);
  }

  @TopicScoped('topic')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTopicSchema)) body: UpdateTopicInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.topics.update(id, body, user);
  }

  /** Skip (or resume) the optional sample-contents step. */
  @TopicScoped('topic')
  @Put(':id/samples-skipped')
  setSamplesSkipped(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetSamplesSkippedSchema)) body: SetSamplesSkippedInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.topics.setSamplesSkipped(id, body, user);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.topics.remove(id, user);
  }

  @TopicScoped('topic')
  @Get(':id/principles')
  principles(@Param('id') id: string) {
    return this.topics.listPrinciples(id);
  }

  @TopicScoped('topic')
  @Post(':id/principles')
  addPrinciple(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreatePrincipleSchema)) body: CreatePrincipleInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.topics.createPrinciple(id, body, user);
  }
}

@Controller('principles')
export class PrinciplesController {
  constructor(private readonly topics: TopicsService) {}

  /** Global principles applied to every topic. */
  @Get('global')
  listGlobal() {
    return this.topics.listPrinciples(null);
  }

  @Post('global')
  @Roles('ADMIN')
  addGlobal(
    @Body(new ZodValidationPipe(CreatePrincipleSchema)) body: CreatePrincipleInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.topics.createPrinciple(null, body, user);
  }

  @TopicScoped('principle')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePrincipleSchema)) body: UpdatePrincipleInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.topics.updatePrinciple(id, body, user);
  }

  @TopicScoped('principle')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.topics.removePrinciple(id, user);
  }
}

@Module({
  controllers: [TopicsController, PrinciplesController],
  providers: [TopicsService],
  exports: [TopicsService],
})
export class TopicsModule {}

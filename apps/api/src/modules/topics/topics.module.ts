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
  Query,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreatePrincipleSchema,
  CreateTopicSchema,
  TopicListQuerySchema,
  UpdatePrincipleSchema,
  UpdateTopicSchema,
  type CreatePrincipleInput,
  type CreateTopicInput,
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

const COUNTS = {
  _count: { select: { samples: true, ideas: true, contents: true, profiles: true } },
  business: { select: { id: true, name: true } },
};

@Injectable()
export class TopicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
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

  async create(input: CreateTopicInput, user: AuthUser) {
    const data = CreateTopicSchema.parse(input);
    await this.assertBusiness(data.businessId, user);
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
      select: { businessId: true },
    });
    // only a new link is checked, so editing a topic linked to a hidden business still works
    if (data.businessId !== current?.businessId) await this.assertBusiness(data.businessId, user);
    const topic = await this.prisma.topic.update({ where: { id }, data });
    this.audit.log({
      userId: user.id,
      action: 'topic.update',
      entityType: 'Topic',
      entityId: id,
      meta: input,
    });
    return topic;
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

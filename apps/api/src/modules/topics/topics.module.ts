import {
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
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { paginate, toPage } from '../../common/pagination';
import { AuditService } from '../audit/audit.service';

const COUNTS = {
  _count: { select: { samples: true, ideas: true, contents: true, profiles: true } },
};

@Injectable()
export class TopicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: z.infer<typeof TopicListQuerySchema>) {
    const where: Prisma.TopicWhereInput = {
      ...(query.status ? { status: query.status } : {}),
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
        include: COUNTS,
        ...paginate(query),
      }),
      this.prisma.topic.count({ where }),
    ]);
    return toPage(items, total, query);
  }

  async get(id: string) {
    const topic = await this.prisma.topic.findUnique({ where: { id }, include: COUNTS });
    if (!topic) throw new NotFoundException('Topic not found');
    return topic;
  }

  async create(input: CreateTopicInput, user: AuthUser) {
    const data = CreateTopicSchema.parse(input);
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
    const topic = await this.prisma.topic.update({
      where: { id },
      data: UpdateTopicSchema.parse(input),
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
  ) {
    return this.topics.list(query);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateTopicSchema)) body: CreateTopicInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.topics.create(body, user);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.topics.get(id);
  }

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

  @Get(':id/principles')
  principles(@Param('id') id: string) {
    return this.topics.listPrinciples(id);
  }

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

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePrincipleSchema)) body: UpdatePrincipleInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.topics.updatePrinciple(id, body, user);
  }

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
